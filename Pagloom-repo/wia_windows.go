//go:build windows

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	ole "github.com/go-ole/go-ole"
	"github.com/go-ole/go-ole/oleutil"
)

const (
	fmtBMP = "{B96B3CAB-0728-11D3-9D7B-0000F81EF32E}"
	fmtPNG = "{B96B3CAF-0728-11D3-9D7B-0000F81EF32E}"
)

var staJobs = make(chan func())

// Todo o COM (WIA e diálogos) corre numa única thread STA.
func startSTA() {
	go func() {
		runtime.LockOSThread()
		ole.CoInitializeEx(0, ole.COINIT_APARTMENTTHREADED)
		for job := range staJobs {
			job()
		}
	}()
}

func onSTA(f func() error) (err error) {
	done := make(chan struct{})
	staJobs <- func() {
		defer close(done)
		defer func() {
			if r := recover(); r != nil {
				err = fmt.Errorf("erro interno: %v", r)
			}
		}()
		err = f()
	}
	<-done
	return
}

var wiaMsgs = map[uint32]string{
	0x80210001: "Erro geral do scanner.",
	0x80210002: "Papel encravado.",
	0x80210003: "Não há papel no alimentador.",
	0x80210004: "Problema com o papel.",
	0x80210005: "O scanner está offline.",
	0x80210006: "O scanner está ocupado.",
	0x80210007: "O scanner está a aquecer. Tenta daqui a pouco.",
	0x80210008: "O scanner precisa de intervenção do utilizador.",
	0x8021000A: "Falha de comunicação com o scanner.",
	0x8021000C: "Definição de hardware incorreta.",
	0x8021000D: "O scanner está bloqueado.",
	0x8021000E: "Exceção no driver do scanner.",
	0x80210015: "Nenhum scanner disponível. Verifica se está ligado.",
	0x80210016: "A tampa do scanner está aberta.",
	0x80210017: "A lâmpada do scanner está desligada.",
	0x80210064: "Operação cancelada.",
}

func toWiaErr(err error) *wiaError {
	if err == nil {
		return nil
	}
	if we, ok := err.(*wiaError); ok {
		return we
	}
	var code uint32
	desc := err.Error()
	if oe, ok := err.(*ole.OleError); ok {
		code = uint32(oe.Code())
		if ei, ok := oe.SubError().(ole.EXCEPINFO); ok && ei.SCODE() != 0 {
			code = ei.SCODE()
		}
		if d := oe.Description(); d != "" {
			desc = d
		}
	}
	if m, ok := wiaMsgs[code]; ok {
		desc = m
	} else if code != 0 {
		desc = fmt.Sprintf("%s (0x%s)", desc, hex32(code))
	}
	return &wiaError{msg: desc, code: code}
}

func create(progID string) (*ole.IDispatch, error) {
	unk, err := oleutil.CreateObject(progID)
	if err != nil {
		return nil, fmt.Errorf("não foi possível criar %s: %v", progID, err)
	}
	defer unk.Release()
	return unk.QueryInterface(ole.IID_IDispatch)
}

func getDisp(d *ole.IDispatch, name string) (*ole.IDispatch, error) {
	v, err := oleutil.GetProperty(d, name)
	if err != nil {
		return nil, err
	}
	return v.ToIDispatch(), nil
}

func toInt(v interface{}) int {
	switch x := v.(type) {
	case int:
		return x
	case int8:
		return int(x)
	case int16:
		return int(x)
	case int32:
		return int(x)
	case int64:
		return int(x)
	case uint8:
		return int(x)
	case uint16:
		return int(x)
	case uint32:
		return int(x)
	case uint64:
		return int(x)
	case float32:
		return int(x)
	case float64:
		return int(x)
	case bool:
		if x {
			return 1
		}
	}
	return 0
}

func propInt(d *ole.IDispatch, name string) int {
	v, err := oleutil.GetProperty(d, name)
	if err != nil {
		return 0
	}
	return toInt(v.Value())
}

// Procura uma propriedade WIA pelo ID numérico ou pelo nome.
func findProp(props *ole.IDispatch, id int, name string) *ole.IDispatch {
	var found *ole.IDispatch
	oleutil.ForEach(props, func(v *ole.VARIANT) error {
		p := v.ToIDispatch()
		if found != nil {
			return nil
		}
		if id != 0 && propInt(p, "PropertyID") == id {
			p.AddRef()
			found = p
		} else if name != "" {
			if n, err := oleutil.GetProperty(p, "Name"); err == nil && strings.EqualFold(n.ToString(), name) {
				p.AddRef()
				found = p
			}
		}
		return nil
	})
	return found
}

func propValue(props *ole.IDispatch, id int, name string) interface{} {
	p := findProp(props, id, name)
	if p == nil {
		return nil
	}
	defer p.Release()
	v, err := oleutil.GetProperty(p, "Value")
	if err != nil {
		return nil
	}
	return v.Value()
}

func propMax(props *ole.IDispatch, id int) int {
	p := findProp(props, id, "")
	if p == nil {
		return 0
	}
	defer p.Release()
	switch propInt(p, "SubType") {
	case 1:
		return propInt(p, "SubTypeMax")
	case 2:
		m := 0
		if vec, err := getDisp(p, "SubTypeValues"); err == nil {
			oleutil.ForEach(vec, func(v *ole.VARIANT) error {
				if x := toInt(v.Value()); x > m {
					m = x
				}
				return nil
			})
		}
		return m
	}
	return propInt(p, "Value")
}

func propRange(props *ole.IDispatch, id int) (int, int, bool) {
	p := findProp(props, id, "")
	if p == nil {
		return 0, 0, false
	}
	defer p.Release()
	if propInt(p, "SubType") == 1 {
		return propInt(p, "SubTypeMin"), propInt(p, "SubTypeMax"), true
	}
	return 0, 0, false
}

// Define uma propriedade com o valor válido mais próximo.
func setNear(props *ole.IDispatch, id int, val int) bool {
	p := findProp(props, id, "")
	if p == nil {
		return false
	}
	defer p.Release()
	if ro, err := oleutil.GetProperty(p, "IsReadOnly"); err == nil && ro.Value() == true {
		return false
	}
	switch propInt(p, "SubType") {
	case 1:
		mn, mx, st := propInt(p, "SubTypeMin"), propInt(p, "SubTypeMax"), propInt(p, "SubTypeStep")
		if st <= 0 {
			st = 1
		}
		if val < mn {
			val = mn
		}
		if val > mx {
			val = mx
		}
		val = mn + ((val-mn)+st/2)/st*st
		if val > mx {
			val = mx
		}
	case 2:
		best, have := 0, false
		if vec, err := getDisp(p, "SubTypeValues"); err == nil {
			oleutil.ForEach(vec, func(v *ole.VARIANT) error {
				x := toInt(v.Value())
				if !have || abs(x-val) < abs(best-val) {
					best, have = x, true
				}
				return nil
			})
		}
		if have {
			val = best
		}
	}
	_, err := oleutil.PutProperty(p, "Value", int32(val))
	return err == nil
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

func listDevices() ([]Device, error) {
	var out []Device
	err := onSTA(func() error {
		dm, err := create("WIA.DeviceManager")
		if err != nil {
			return err
		}
		defer dm.Release()
		infos, err := getDisp(dm, "DeviceInfos")
		if err != nil {
			return toWiaErr(err)
		}
		return oleutil.ForEach(infos, func(v *ole.VARIANT) error {
			di := v.ToIDispatch()
			d := Device{Type: propInt(di, "Type")}
			if id, err := oleutil.GetProperty(di, "DeviceID"); err == nil {
				d.ID = id.ToString()
			}
			if props, err := getDisp(di, "Properties"); err == nil {
				if n := propValue(props, 0, "Name"); n != nil {
					d.Name = fmt.Sprint(n)
				}
			}
			if d.Name == "" {
				d.Name = d.ID
			}
			out = append(out, d)
			return nil
		})
	})
	return out, err
}

func connect(id string) (*ole.IDispatch, error) {
	dm, err := create("WIA.DeviceManager")
	if err != nil {
		return nil, err
	}
	defer dm.Release()
	infos, err := getDisp(dm, "DeviceInfos")
	if err != nil {
		return nil, toWiaErr(err)
	}
	var dev *ole.IDispatch
	var cerr error
	oleutil.ForEach(infos, func(v *ole.VARIANT) error {
		di := v.ToIDispatch()
		if dev != nil {
			return nil
		}
		if x, err := oleutil.GetProperty(di, "DeviceID"); err == nil && x.ToString() == id {
			r, err := oleutil.CallMethod(di, "Connect")
			if err != nil {
				cerr = err
				return nil
			}
			dev = r.ToIDispatch()
		}
		return nil
	})
	if cerr != nil {
		return nil, toWiaErr(cerr)
	}
	if dev == nil {
		return nil, &wiaError{msg: "Scanner não encontrado. Carrega em ↻ para atualizar a lista.", code: 0x80210015}
	}
	return dev, nil
}

func configure(dev, item *ole.IDispatch, o ScanOptions) int {
	if dp, err := getDisp(dev, "Properties"); err == nil {
		switch o.Source {
		case "feeder":
			setNear(dp, 3088, 1)
		case "duplex":
			setNear(dp, 3088, 5)
		default:
			setNear(dp, 3088, 2)
		}
		if o.Source != "flatbed" {
			setNear(dp, 3096, 1)
		}
	}
	P, err := getDisp(item, "Properties")
	if err != nil {
		return o.DPI
	}
	mode := o.Mode
	if mode == 0 {
		mode = 1
	}
	setNear(P, 6146, mode)
	dt := 3
	if mode == 2 {
		dt = 2
	} else if mode == 4 {
		dt = 0
	}
	setNear(P, 4103, dt)
	setNear(P, 6147, o.DPI)
	setNear(P, 6148, o.DPI)
	dpi := toInt(propValue(P, 6147, ""))
	if dpi <= 0 {
		dpi = o.DPI
	}
	setNear(P, 6149, 0)
	setNear(P, 6150, 0)
	mw, mh := propMax(P, 6151), propMax(P, 6152)
	w, h := mw, mh
	if a, ok := areas[o.Area]; ok {
		w = int(a[0]/25.4*float64(dpi) + 0.5)
		h = int(a[1]/25.4*float64(dpi) + 0.5)
		if mw > 0 && w > mw {
			w = mw
		}
		if mh > 0 && h > mh {
			h = mh
		}
	}
	if w > 0 {
		setNear(P, 6151, w)
	}
	if h > 0 {
		setNear(P, 6152, h)
	}
	if mn, mx, ok := propRange(P, 6154); ok {
		setNear(P, 6154, (mn+mx)/2+o.Brightness*(mx-mn)/200)
	}
	if mn, mx, ok := propRange(P, 6155); ok {
		setNear(P, 6155, (mn+mx)/2+o.Contrast*(mx-mn)/200)
	}
	return dpi
}

func saveImageFile(img *ole.IDispatch, dpiHint int) (ScannedPage, error) {
	ext := "png"
	if e, err := oleutil.GetProperty(img, "FileExtension"); err == nil && e.ToString() != "" {
		ext = strings.ToLower(e.ToString())
	}
	path := filepath.Join(tmpDir, randHex(8)+"."+ext)
	if _, err := oleutil.CallMethod(img, "SaveFile", path); err != nil {
		return ScannedPage{}, toWiaErr(err)
	}
	dpi := float64(propInt(img, "HorizontalResolution"))
	if dpi < 10 {
		dpi = float64(dpiHint)
	}
	mimeT := "image/png"
	switch ext {
	case "bmp":
		mimeT = "image/bmp"
	case "jpg", "jpeg":
		mimeT = "image/jpeg"
	case "tif", "tiff":
		mimeT = "image/tiff"
	}
	return ScannedPage{ID: addImage(path), DPI: dpi, W: propInt(img, "Width"), H: propInt(img, "Height"), Mime: mimeT}, nil
}

// Garante um formato que o browser consegue ler (PNG).
func ensurePNG(img *ole.IDispatch) *ole.IDispatch {
	if f, err := oleutil.GetProperty(img, "FormatID"); err == nil && strings.EqualFold(f.ToString(), fmtPNG) {
		return img
	}
	ip, err := create("WIA.ImageProcess")
	if err != nil {
		return img
	}
	defer ip.Release()
	infos, err := getDisp(ip, "FilterInfos")
	if err != nil {
		return img
	}
	var fid string
	oleutil.ForEach(infos, func(v *ole.VARIANT) error {
		fi := v.ToIDispatch()
		if n, err := oleutil.GetProperty(fi, "Name"); err == nil && n.ToString() == "Convert" {
			if id, err := oleutil.GetProperty(fi, "FilterID"); err == nil {
				fid = id.ToString()
			}
		}
		return nil
	})
	if fid == "" {
		return img
	}
	filters, err := getDisp(ip, "Filters")
	if err != nil {
		return img
	}
	if _, err := oleutil.CallMethod(filters, "Add", fid); err != nil {
		return img
	}
	var last *ole.IDispatch
	oleutil.ForEach(filters, func(v *ole.VARIANT) error { last = v.ToIDispatch(); last.AddRef(); return nil })
	if last == nil {
		return img
	}
	if fp, err := getDisp(last, "Properties"); err == nil {
		if p := findProp(fp, 0, "FormatID"); p != nil {
			oleutil.PutProperty(p, "Value", fmtPNG)
		}
	}
	r, err := oleutil.CallMethod(ip, "Apply", img)
	if err != nil {
		return img
	}
	return r.ToIDispatch()
}

func transfer(cd, item *ole.IDispatch) (*ole.IDispatch, error) {
	r, err := oleutil.CallMethod(cd, "ShowTransfer", item, fmtPNG, true)
	if err != nil {
		we := toWiaErr(err)
		if _, known := wiaMsgs[we.code]; known {
			return nil, we
		}
		r, err = oleutil.CallMethod(cd, "ShowTransfer", item, fmtBMP, true)
		if err != nil {
			return nil, toWiaErr(err)
		}
	}
	if r == nil || r.VT == ole.VT_EMPTY || r.VT == ole.VT_NULL {
		return nil, nil
	}
	return r.ToIDispatch(), nil
}

func scan(o ScanOptions) ([]ScannedPage, error) {
	var pages []ScannedPage
	err := onSTA(func() error {
		cd, err := create("WIA.CommonDialog")
		if err != nil {
			return err
		}
		defer cd.Release()

		if o.UI {
			// Janela do próprio driver
			r, err := oleutil.CallMethod(cd, "ShowAcquireImage", 1, 0, 0, fmtPNG, true, true, false)
			if err != nil {
				return toWiaErr(err)
			}
			if r == nil || r.VT == ole.VT_EMPTY || r.VT == ole.VT_NULL {
				return &wiaError{msg: "Operação cancelada.", code: 0x80210064}
			}
			pg, err := saveImageFile(ensurePNG(r.ToIDispatch()), o.DPI)
			if err != nil {
				return err
			}
			pages = append(pages, pg)
			return nil
		}

		dev, err := connect(o.Device)
		if err != nil {
			return err
		}
		defer dev.Release()
		items, err := getDisp(dev, "Items")
		if err != nil {
			return toWiaErr(err)
		}
		var item *ole.IDispatch
		oleutil.ForEach(items, func(v *ole.VARIANT) error {
			if item == nil {
				item = v.ToIDispatch()
				item.AddRef()
			}
			return nil
		})
		if item == nil {
			return &wiaError{msg: "O scanner não devolveu nenhum item para digitalizar.", code: 0x80210001}
		}
		defer item.Release()
		dpi := configure(dev, item, o)
		feeder := o.Source != "flatbed"
		for n := 0; n < 500; n++ {
			img, err := transfer(cd, item)
			if err != nil {
				if feeder && len(pages) > 0 && err.(*wiaError).code == 0x80210003 {
					return nil // alimentador vazio: terminou
				}
				return err
			}
			if img == nil {
				break
			}
			pg, err := saveImageFile(ensurePNG(img), dpi)
			img.Release()
			if err != nil {
				return err
			}
			pages = append(pages, pg)
			if !feeder {
				break
			}
		}
		return nil
	})
	return pages, err
}

var _ = os.Remove
