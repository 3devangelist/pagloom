// Scanner simulado (para testes: PAGLOOM_MOCK=1).
package main

import (
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"time"
)

func mockDevices() ([]Device, error) {
	return []Device{{ID: "mock1", Name: "EPSON ET-2850 Series (simulado)", Type: 1}, {ID: "mock2", Name: "EPSON3D3D39 (simulado)", Type: 1}}, nil
}

var mockCount = 0

func mockScan(o ScanOptions) ([]ScannedPage, error) {
	n := 1
	if o.Source != "flatbed" {
		n = 3
	}
	var out []ScannedPage
	for k := 0; k < n; k++ {
		mockCount++
		dpi := o.DPI
		if dpi == 0 {
			dpi = 150
		}
		w, h := int(210/25.4*float64(dpi)), int(297/25.4*float64(dpi))
		img := image.NewRGBA(image.Rect(0, 0, w, h))
		ang := 0.03 * float64(mockCount%3-1)
		for y := 0; y < h; y++ {
			for x := 0; x < w; x++ {
				c := color.RGBA{232, 226, 205, 255} // papel amarelado
				xr := float64(x)*math.Cos(ang) + float64(y)*math.Sin(ang)
				yr := -float64(x)*math.Sin(ang) + float64(y)*math.Cos(ang)
				line := int(yr) % (dpi / 4)
				if xr > float64(w)/10 && xr < float64(w)*0.9 && yr > float64(h)/10 && yr < float64(h)*0.9 && line >= 0 && line < dpi/40 {
					c = color.RGBA{40, 40, 60, 255}
				}
				if int(yr) > h/10 && int(yr) < h/10+dpi/3 && xr > float64(w)/10 && xr < float64(w)/10+float64(dpi*mockCount%5+dpi) {
					c = color.RGBA{180, 30, 30, 255}
				}
				img.Set(x, y, c)
			}
		}
		path := filepath.Join(tmpDir, randHex(8)+".png")
		f, _ := os.Create(path)
		png.Encode(f, img)
		f.Close()
		out = append(out, ScannedPage{ID: addImage(path), DPI: float64(dpi), W: w, H: h, Mime: "image/png"})
		time.Sleep(200 * time.Millisecond)
	}
	return out, nil
}
