//go:build windows

package main

import (
	"fmt"
	"runtime"
	"unicode/utf16"

	ole "github.com/go-ole/go-ole"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
)

var (
	user32         = syscall.NewLazyDLL("user32.dll")
	comdlg32       = syscall.NewLazyDLL("comdlg32.dll")
	shell32        = syscall.NewLazyDLL("shell32.dll")
	pMessageBox    = user32.NewProc("MessageBoxW")
	pShowWindow    = user32.NewProc("ShowWindow")
	pGetSaveFile   = comdlg32.NewProc("GetSaveFileNameW")
	pShellExecute  = shell32.NewProc("ShellExecuteW")
	pSetForeground = user32.NewProc("SetForegroundWindow")
	mainHwnd       uintptr
)

func u16(s string) *uint16 { p, _ := syscall.UTF16PtrFromString(s); return p }

func fatal(msg string) {
	pMessageBox.Call(0, uintptr(unsafe.Pointer(u16(msg))), uintptr(unsafe.Pointer(u16("Pagloom"))), 0x10)
	os.Exit(1)
}

func runWindow(url string) bool {
	dataPath := filepath.Join(os.Getenv("LOCALAPPDATA"), "Pagloom", "WebView2")
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     os.Getenv("PAGLOOM_DEBUG") != "",
		AutoFocus: true,
		DataPath:  dataPath,
		WindowOptions: webview2.WindowOptions{
			Title:  "Pagloom",
			Width:  1400,
			Height: 900,
			IconId: 1,
			Center: true,
		},
	})
	if w == nil {
		return false
	}
	defer w.Destroy()
	mainHwnd = uintptr(w.Window())
	pShowWindow.Call(mainHwnd, 3) // maximizar
	w.Navigate(url)
	w.Run()
	return true
}

type openFileNameW struct {
	lStructSize       uint32
	hwndOwner         uintptr
	hInstance         uintptr
	lpstrFilter       *uint16
	lpstrCustomFilter *uint16
	nMaxCustFilter    uint32
	nFilterIndex      uint32
	lpstrFile         *uint16
	nMaxFile          uint32
	lpstrFileTitle    *uint16
	nMaxFileTitle     uint32
	lpstrInitialDir   *uint16
	lpstrTitle        *uint16
	Flags             uint32
	nFileOffset       uint16
	nFileExtension    uint16
	lpstrDefExt       *uint16
	lCustData         uintptr
	lpfnHook          uintptr
	lpTemplateName    *uint16
	pvReserved        uintptr
	dwReserved        uint32
	FlagsEx           uint32
}

var pCommDlgErr = comdlg32.NewProc("CommDlgExtendedError")

type dlgRes struct {
	path string
	ok   bool
	code uintptr
}

// Mostra o "Guardar como" numa thread própria (STA), para não depender de mais nada.
func runSaveDialog(owner uintptr, name, ext, desc, initialDir string) dlgRes {
	ch := make(chan dlgRes, 1)
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		ole.CoInitializeEx(0, ole.COINIT_APARTMENTTHREADED)
		defer ole.CoUninitialize()
		defer func() {
			if r := recover(); r != nil {
				ch <- dlgRes{code: 0xFFFF}
			}
		}()
		filter := desc + " (*." + ext + ")\x00*." + ext + "\x00Todos os ficheiros (*.*)\x00*.*\x00\x00"
		f16 := utf16.Encode([]rune(filter))
		buf := make([]uint16, 32768)
		copy(buf, syscall.StringToUTF16(name))
		ofn := openFileNameW{
			hwndOwner:    owner,
			lpstrFilter:  &f16[0],
			nFilterIndex: 1,
			lpstrFile:    &buf[0],
			nMaxFile:     uint32(len(buf)),
			lpstrTitle:   u16("Guardar como"),
			Flags:        0x00000002 | 0x00000800 | 0x00000008 | 0x00080000, // OVERWRITEPROMPT|PATHMUSTEXIST|NOCHANGEDIR|EXPLORER
			lpstrDefExt:  u16(ext),
		}
		if initialDir != "" {
			ofn.lpstrInitialDir = u16(initialDir)
		}
		ofn.lStructSize = uint32(unsafe.Sizeof(ofn))
		r, _, _ := pGetSaveFile.Call(uintptr(unsafe.Pointer(&ofn)))
		if r != 0 {
			ch <- dlgRes{path: syscall.UTF16ToString(buf), ok: true}
			return
		}
		code, _, _ := pCommDlgErr.Call()
		ch <- dlgRes{code: code}
	}()
	return <-ch
}

func saveDialog(name, ext, desc, initialDir string) (string, bool, string) {
	name = safeFileName(name)
	if desc == "" {
		desc = strings.ToUpper(ext)
	}
	docs := documentsDir()
	if initialDir == "" {
		initialDir = docs
	}
	r := runSaveDialog(mainHwnd, name, ext, desc, initialDir)
	if !r.ok && r.code != 0 {
		r = runSaveDialog(0, name, ext, desc, "") // segunda tentativa, sem dono nem pasta inicial
	}
	if r.ok {
		return r.path, true, ""
	}
	if r.code == 0 {
		return "", false, "" // cancelado pelo utilizador
	}
	// A janela não abriu: grava em Documentos\Digitalizações
	p := autoSavePath(docs, name, ext)
	return p, true, fmt.Sprintf("A janela \"Guardar como\" não abriu (erro 0x%X); o ficheiro foi gravado em Documentos\\Digitalizações.", r.code)
}

func documentsDir() string {
	h, _ := os.UserHomeDir()
	if p := os.Getenv("USERPROFILE"); p != "" {
		h = p
	}
	return filepath.Join(h, "Documents")
}

func reveal(path string) {
	if path == "" {
		return
	}
	exec.Command("explorer.exe", "/select,"+path).Start()
}

func openURL(url string) {
	pShellExecute.Call(0, uintptr(unsafe.Pointer(u16("open"))), uintptr(unsafe.Pointer(u16(url))), 0, 0, 1)
}

var _ = pSetForeground
