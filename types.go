package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Nome de ficheiro sem caracteres proibidos no Windows.
func safeFileName(s string) string {
	s = strings.Map(func(r rune) rune {
		if strings.ContainsRune(`\/:*?"<>|`, r) || r < 32 {
			return '_'
		}
		return r
	}, s)
	s = strings.TrimSpace(s)
	if s == "" || s[0] == '.' {
		s = "Digitalizacao" + s
	}
	return s
}

func autoSavePath(docs, name, ext string) string {
	dir := filepath.Join(docs, "Digitalizações")
	os.MkdirAll(dir, 0755)
	base := strings.TrimSuffix(name, filepath.Ext(name))
	p := filepath.Join(dir, base+"."+ext)
	for i := 2; ; i++ {
		if _, err := os.Stat(p); os.IsNotExist(err) {
			return p
		}
		p = filepath.Join(dir, fmt.Sprintf("%s (%d).%s", base, i, ext))
	}
}

type ScanOptions struct {
	Device     string `json:"device"`
	Source     string `json:"source"` // flatbed | feeder | duplex
	Mode       int    `json:"mode"`   // 1 cor, 2 cinzento, 4 p&b
	DPI        int    `json:"dpi"`
	Area       string `json:"area"` // max | a4 | a5 | letter
	Brightness int    `json:"brightness"`
	Contrast   int    `json:"contrast"`
	UI         bool   `json:"ui"`
}

type ScannedPage struct {
	ID   string  `json:"id"`
	DPI  float64 `json:"dpi"`
	W    int     `json:"w"`
	H    int     `json:"h"`
	Mime string  `json:"mime"`
}

type Device struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type int    `json:"type"`
}

type wiaError struct {
	msg  string
	code uint32
}

func (e *wiaError) Error() string   { return e.msg }
func (e *wiaError) HResult() string { return hex32(e.code) }

func hex32(v uint32) string {
	const d = "0123456789ABCDEF"
	b := make([]byte, 8)
	for i := 7; i >= 0; i-- {
		b[i] = d[v&15]
		v >>= 4
	}
	return string(b)
}

var areas = map[string][2]float64{
	"a4":     {210, 297},
	"a5":     {148, 210},
	"letter": {215.9, 279.4},
}

type DepState struct {
	OK       bool     `json:"ok"`
	Missing  []string `json:"missing"`  // componentes em falta (descrição)
	Packages []string `json:"packages"` // pacotes a instalar
	PM       string   `json:"pm"`       // gestor de pacotes
	Command  string   `json:"command"`  // comando equivalente para o terminal
}
