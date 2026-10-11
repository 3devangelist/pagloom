//go:build linux

// Digitalização em Linux através do SANE (comando scanimage).
package main

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
)

var saneMu sync.Mutex

func startSTA() {}

func mockMode() bool { return os.Getenv("PAGLOOM_MOCK") != "" }

func scanimagePath() (string, error) {
	p, err := exec.LookPath("scanimage")
	if err != nil {
		return "", &wiaError{msg: "O SANE não está instalado. Instala com: sudo apt install sane-utils (e sane-airscan para scanners de rede).", code: 0x80210015}
	}
	return p, nil
}

func listDevices() ([]Device, error) {
	if mockMode() {
		return mockDevices()
	}
	si, err := scanimagePath()
	if err != nil {
		return nil, err
	}
	saneMu.Lock()
	defer saneMu.Unlock()
	out, err := command(si, "-f", "%d\t%v\t%m\t%t%n").Output()
	if err != nil && len(out) == 0 {
		return nil, saneErr(err, nil)
	}
	var devs []Device
	seen := map[string]bool{}
	for _, ln := range strings.Split(string(out), "\n") {
		f := strings.Split(strings.TrimSpace(ln), "\t")
		if len(f) < 4 || f[0] == "" || seen[f[0]] {
			continue
		}
		seen[f[0]] = true
		name := strings.TrimSpace(f[1] + " " + f[2])
		if strings.HasPrefix(f[0], "airscan:") || strings.HasPrefix(f[0], "escl:") {
			name += " (rede)"
		}
		devs = append(devs, Device{ID: f[0], Name: name, Type: 1})
	}
	return devs, nil
}

// ---------------- opções do backend (scanimage -A) ----------------

type saneOpt struct {
	list     []string
	isRange  bool
	min, max float64
	inactive bool
}

var (
	reOpt   = regexp.MustCompile(`^\s+(-{1,2}[A-Za-z0-9][\w-]*)\s+(.+?)\s*\[(.*?)\]\s*$`)
	reRange = regexp.MustCompile(`^(-?[\d.]+)\.\.(-?[\d.]+)`)
	reUnit  = regexp.MustCompile(`(dpi|mm|%|us|bit|pel)$`)
)

func saneOptions(si, dev string) map[string]*saneOpt {
	out, _ := command(si, "-d", dev, "-A").CombinedOutput()
	opts := map[string]*saneOpt{}
	sc := bufio.NewScanner(bytes.NewReader(out))
	for sc.Scan() {
		m := reOpt.FindStringSubmatch(sc.Text())
		if m == nil {
			continue
		}
		name, vals, def := strings.TrimLeft(m[1], "-"), m[2], m[3]
		vals = strings.TrimSpace(regexp.MustCompile(`\(in steps of [^)]*\)`).ReplaceAllString(vals, ""))
		o := &saneOpt{inactive: def == "inactive"}
		if r := reRange.FindStringSubmatch(vals); r != nil {
			o.isRange = true
			o.min, _ = strconv.ParseFloat(r[1], 64)
			o.max, _ = strconv.ParseFloat(strings.TrimRight(r[2], "."), 64)
		} else {
			for _, v := range strings.Split(vals, "|") {
				o.list = append(o.list, strings.TrimSpace(reUnit.ReplaceAllString(strings.TrimSpace(v), "")))
			}
		}
		opts[name] = o
	}
	return opts
}

func pickValue(o *saneOpt, patterns []string, exclude string) string {
	if o == nil {
		return ""
	}
	for _, p := range patterns {
		re := regexp.MustCompile("(?i)" + p)
		for _, v := range o.list {
			if re.MatchString(v) && (exclude == "" || !regexp.MustCompile("(?i)"+exclude).MatchString(v)) {
				return v
			}
		}
	}
	return ""
}

func nearestNum(o *saneOpt, want float64) float64 {
	if o == nil {
		return want
	}
	if o.isRange {
		return math.Max(o.min, math.Min(o.max, want))
	}
	best, have := want, false
	for _, v := range o.list {
		f, err := strconv.ParseFloat(v, 64)
		if err != nil {
			continue
		}
		if !have || math.Abs(f-want) < math.Abs(best-want) {
			best, have = f, true
		}
	}
	return best
}

func fmtNum(f float64) string { return strconv.FormatFloat(f, 'f', -1, 64) }

// ---------------- digitalizar ----------------

func scan(o ScanOptions) ([]ScannedPage, error) {
	if mockMode() {
		return mockScan(o)
	}
	if o.UI {
		return nil, &wiaError{msg: "A janela do driver só existe no Windows.", code: 0x80210001}
	}
	si, err := scanimagePath()
	if err != nil {
		return nil, err
	}
	if o.Device == "" {
		return nil, &wiaError{msg: "Escolhe um scanner.", code: 0x80210015}
	}
	saneMu.Lock()
	defer saneMu.Unlock()

	opts := saneOptions(si, o.Device)
	help, _ := command(si, "--help").CombinedOutput()
	format := "pnm"
	if bytes.Contains(help, []byte("png")) {
		format = "png"
	}
	args := []string{"-d", o.Device, "--format=" + format}

	// origem
	feeder := o.Source != "flatbed"
	if so := opts["source"]; so != nil && !so.inactive {
		var v string
		switch o.Source {
		case "duplex":
			v = pickValue(so, []string{"duplex"}, "")
		case "feeder":
			v = pickValue(so, []string{"adf", "feeder", "automatic", "document"}, "duplex|back")
		default:
			v = pickValue(so, []string{"flatbed", "platen", "normal", "glass"}, "")
		}
		if v != "" {
			args = append(args, "--source", v)
		}
	}
	// modo de cor
	if mo := opts["mode"]; mo != nil && !mo.inactive {
		var v string
		switch o.Mode {
		case 2:
			v = pickValue(mo, []string{"^gr[ae]y", "gray|grey"}, "")
		case 4:
			v = pickValue(mo, []string{"lineart", "binary", "black", "mono", "halftone"}, "")
		default:
			v = pickValue(mo, []string{"^colou?r$", "colou?r", "rgb"}, "")
		}
		if v != "" {
			args = append(args, "--mode", v)
		}
	}
	// resolução
	dpi := float64(o.DPI)
	if dpi <= 0 {
		dpi = 300
	}
	if ro := opts["resolution"]; ro != nil {
		dpi = nearestNum(ro, dpi)
		args = append(args, "--resolution", fmtNum(dpi))
	}
	// área (mm)
	if ox, oy := opts["x"], opts["y"]; ox != nil && oy != nil && ox.isRange && oy.isRange {
		w, h := ox.max, oy.max
		if a, ok := areas[o.Area]; ok {
			w, h = math.Min(a[0], ox.max), math.Min(a[1], oy.max)
		}
		if opts["l"] != nil {
			args = append(args, "-l", "0")
		}
		if opts["t"] != nil {
			args = append(args, "-t", "0")
		}
		args = append(args, "-x", fmtNum(math.Round(w*10)/10), "-y", fmtNum(math.Round(h*10)/10))
	}
	// brilho / contraste (-100..100 mapeado para a gama do backend)
	for name, val := range map[string]int{"brightness": o.Brightness, "contrast": o.Contrast} {
		if op := opts[name]; op != nil && op.isRange && !op.inactive && val != 0 {
			v := (op.min+op.max)/2 + float64(val)/200*(op.max-op.min)
			args = append(args, "--"+name, fmtNum(math.Round(v)))
		}
	}

	dir, err := os.MkdirTemp(tmpDir, "scan")
	if err != nil {
		return nil, err
	}
	var stderr bytes.Buffer
	if feeder {
		args = append(args, "--batch="+filepath.Join(dir, "p%04d."+format))
		cmd := command(si, args...)
		cmd.Stderr = &stderr
		runErr := cmd.Run()
		files, _ := filepath.Glob(filepath.Join(dir, "p*."+format))
		sort.Strings(files)
		var pages []ScannedPage
		for _, f := range files {
			if pg, err := finishFile(f, format, dpi); err == nil {
				pages = append(pages, pg)
			}
		}
		if len(pages) == 0 {
			return nil, saneErr(runErr, stderr.Bytes())
		}
		return pages, nil
	}
	out := filepath.Join(dir, "p0001."+format)
	f, err := os.Create(out)
	if err != nil {
		return nil, err
	}
	cmd := command(si, args...)
	cmd.Stdout = f
	cmd.Stderr = &stderr
	runErr := cmd.Run()
	f.Close()
	if st, _ := os.Stat(out); runErr != nil || st == nil || st.Size() == 0 {
		return nil, saneErr(runErr, stderr.Bytes())
	}
	pg, err := finishFile(out, format, dpi)
	if err != nil {
		return nil, err
	}
	return []ScannedPage{pg}, nil
}

func finishFile(path, format string, dpi float64) (ScannedPage, error) {
	if format == "pnm" {
		png, err := pnmToPNG(path)
		if err != nil {
			return ScannedPage{}, err
		}
		os.Remove(path)
		path = png
	}
	f, err := os.Open(path)
	if err != nil {
		return ScannedPage{}, err
	}
	cfg, err := png.DecodeConfig(f)
	f.Close()
	if err != nil {
		return ScannedPage{}, fmt.Errorf("imagem inválida do scanner: %v", err)
	}
	return ScannedPage{ID: addImage(path), DPI: dpi, W: cfg.Width, H: cfg.Height, Mime: "image/png"}, nil
}

func saneErr(err error, stderr []byte) error {
	msg := strings.TrimSpace(string(stderr))
	if i := strings.LastIndex(msg, "\n"); i >= 0 {
		msg = strings.TrimSpace(msg[i+1:])
	}
	low := strings.ToLower(msg)
	switch {
	case strings.Contains(low, "out of documents") || strings.Contains(low, "no documents"):
		return &wiaError{msg: "Não há papel no alimentador.", code: 0x80210003}
	case strings.Contains(low, "jammed"):
		return &wiaError{msg: "Papel encravado.", code: 0x80210002}
	case strings.Contains(low, "busy"):
		return &wiaError{msg: "O scanner está ocupado.", code: 0x80210006}
	case strings.Contains(low, "cover"):
		return &wiaError{msg: "A tampa do scanner está aberta.", code: 0x80210016}
	case strings.Contains(low, "i/o") || strings.Contains(low, "open of device"):
		return &wiaError{msg: "Falha de comunicação com o scanner (" + msg + ").", code: 0x8021000A}
	}
	if msg == "" && err != nil {
		msg = err.Error()
	}
	if msg == "" {
		msg = "O scanner não devolveu nenhuma imagem."
	}
	return &wiaError{msg: msg, code: 0x80210001}
}

// ---------------- PNM -> PNG (para versões antigas do scanimage) ----------------

func pnmToPNG(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	r := bufio.NewReader(bytes.NewReader(b))
	tok := func() (string, error) {
		var s []byte
		for {
			c, err := r.ReadByte()
			if err != nil {
				return string(s), err
			}
			if c == '#' {
				r.ReadString('\n')
				continue
			}
			if c == ' ' || c == '\n' || c == '\r' || c == '\t' {
				if len(s) > 0 {
					return string(s), nil
				}
				continue
			}
			s = append(s, c)
		}
	}
	magic, _ := tok()
	ws, _ := tok()
	hs, _ := tok()
	w, _ := strconv.Atoi(ws)
	h, _ := strconv.Atoi(hs)
	maxv := 1
	if magic != "P4" {
		ms, _ := tok()
		maxv, _ = strconv.Atoi(ms)
	}
	if w <= 0 || h <= 0 || maxv <= 0 {
		return "", errors.New("PNM inválido")
	}
	var img image.Image
	switch magic {
	case "P6":
		m := image.NewNRGBA(image.Rect(0, 0, w, h))
		bpp := 1
		if maxv > 255 {
			bpp = 2
		}
		buf := make([]byte, w*3*bpp)
		for y := 0; y < h; y++ {
			if _, err := io.ReadFull(r, buf); err != nil {
				break
			}
			for x := 0; x < w; x++ {
				i := x * 3 * bpp
				m.Pix[y*m.Stride+x*4+0] = buf[i]
				m.Pix[y*m.Stride+x*4+1] = buf[i+bpp]
				m.Pix[y*m.Stride+x*4+2] = buf[i+2*bpp]
				m.Pix[y*m.Stride+x*4+3] = 255
			}
		}
		img = m
	case "P5":
		m := image.NewGray(image.Rect(0, 0, w, h))
		bpp := 1
		if maxv > 255 {
			bpp = 2
		}
		buf := make([]byte, w*bpp)
		for y := 0; y < h; y++ {
			if _, err := io.ReadFull(r, buf); err != nil {
				break
			}
			for x := 0; x < w; x++ {
				m.Pix[y*m.Stride+x] = buf[x*bpp]
			}
		}
		img = m
	case "P4":
		m := image.NewGray(image.Rect(0, 0, w, h))
		buf := make([]byte, (w+7)/8)
		for y := 0; y < h; y++ {
			if _, err := io.ReadFull(r, buf); err != nil {
				break
			}
			for x := 0; x < w; x++ {
				if buf[x/8]&(0x80>>uint(x%8)) != 0 {
					m.SetGray(x, y, color.Gray{0})
				} else {
					m.SetGray(x, y, color.Gray{255})
				}
			}
		}
		img = m
	default:
		return "", errors.New("formato PNM não suportado: " + magic)
	}
	out := strings.TrimSuffix(path, filepath.Ext(path)) + ".png"
	f, err := os.Create(out)
	if err != nil {
		return "", err
	}
	defer f.Close()
	return out, png.Encode(f, img)
}
