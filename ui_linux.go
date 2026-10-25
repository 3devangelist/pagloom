//go:build linux

package main

import (
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

func fatal(msg string) {
	fmt.Fprintln(os.Stderr, msg)
	if z, err := exec.LookPath("zenity"); err == nil {
		exec.Command(z, "--error", "--title=Pagloom", "--text="+msg).Run()
	} else if k, err := exec.LookPath("kdialog"); err == nil {
		exec.Command(k, "--error", msg, "--title", "Pagloom").Run()
	}
	os.Exit(1)
}

func cleanEnv() []string {
	// Dentro de um AppImage não passamos as variáveis do AppImage aos programas do sistema.
	var env []string
	for _, e := range os.Environ() {
		if strings.HasPrefix(e, "LD_LIBRARY_PATH=") || strings.HasPrefix(e, "LD_PRELOAD=") {
			continue
		}
		env = append(env, e)
	}
	return env
}

func command(name string, args ...string) *exec.Cmd {
	c := exec.Command(name, args...)
	c.Env = cleanEnv()
	return c
}

// Abre a interface numa janela "app" de um browser Chromium (Chrome, Chromium, Edge, Brave).
// Com um perfil próprio, o processo termina quando a janela fecha — e o Pagloom também.
func runWindow(u string) bool {
	if os.Getenv("PAGLOOM_NO_WINDOW") != "" {
		return false
	}
	for _, b := range []string{"chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "microsoft-edge", "microsoft-edge-stable", "brave-browser", "brave"} {
		p, err := exec.LookPath(b)
		if err != nil {
			continue
		}
		cfg, _ := os.UserConfigDir()
		prof := filepath.Join(cfg, "Pagloom", "browser")
		os.MkdirAll(prof, 0755)
		cmd := command(p, "--app="+u, "--user-data-dir="+prof, "--no-first-run", "--no-default-browser-check",
			"--window-size=1400,900", "--start-maximized", "--class=Pagloom")
		if err := cmd.Start(); err != nil {
			continue
		}
		t0 := time.Now()
		cmd.Wait()
		if time.Since(t0) < 5*time.Second {
			// o browser entregou a janela a uma instância já aberta: fica ativo enquanto a página responder
			waitHeartbeat()
		}
		return true
	}
	// Chromium/Chrome/Edge/Brave instalados por Flatpak (comum no Fedora)
	if fp, err := exec.LookPath("flatpak"); err == nil {
		for _, id := range []string{"org.chromium.Chromium", "com.google.Chrome", "com.microsoft.Edge", "com.brave.Browser"} {
			if command(fp, "info", id).Run() != nil {
				continue
			}
			cmd := command(fp, "run", id, "--app="+u, "--window-size=1400,900", "--start-maximized")
			if err := cmd.Start(); err != nil {
				continue
			}
			t0 := time.Now()
			cmd.Wait()
			if time.Since(t0) < 5*time.Second {
				waitHeartbeat()
			}
			return true
		}
	}
	return false // sem Chromium: abre no browser predefinido (Firefox, etc.)
}

func openURL(u string) {
	command("xdg-open", u).Start()
}

func reveal(path string) {
	if path == "" {
		return
	}
	uri := (&url.URL{Scheme: "file", Path: path}).String()
	if g, err := exec.LookPath("gdbus"); err == nil {
		err = command(g, "call", "--session", "--dest", "org.freedesktop.FileManager1",
			"--object-path", "/org/freedesktop/FileManager1", "--method", "org.freedesktop.FileManager1.ShowItems",
			"['"+strings.ReplaceAll(uri, "'", "%27")+"']", "").Run()
		if err == nil {
			return
		}
	}
	command("xdg-open", filepath.Dir(path)).Start()
}

// Memória física total e disponível, em bytes (de /proc/meminfo; para decidir quantas fotos tratar em paralelo)
func memInfo() (total, avail uint64) {
	b, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0, 0
	}
	for _, line := range strings.Split(string(b), "\n") {
		f := strings.Fields(line) // "MemTotal:  16299764 kB"
		if len(f) < 2 {
			continue
		}
		var kb uint64
		if _, err := fmt.Sscan(f[1], &kb); err != nil {
			continue
		}
		switch f[0] {
		case "MemTotal:":
			total = kb * 1024
		case "MemAvailable:":
			avail = kb * 1024
		}
	}
	return total, avail
}

func documentsDir() string {
	if out, err := command("xdg-user-dir", "DOCUMENTS").Output(); err == nil {
		if d := strings.TrimSpace(string(out)); d != "" {
			return d
		}
	}
	h, _ := os.UserHomeDir()
	for _, n := range []string{"Documentos", "Documents"} {
		if st, err := os.Stat(filepath.Join(h, n)); err == nil && st.IsDir() {
			return filepath.Join(h, n)
		}
	}
	return h
}

func saveDialog(name, ext, desc, initialDir string) (string, bool, string) {
	name = safeFileName(name)
	if initialDir == "" {
		initialDir = documentsDir()
	}
	start := filepath.Join(initialDir, name)
	if desc == "" {
		desc = strings.ToUpper(ext)
	}
	fixExt := func(p string) string {
		if ext != "" && !strings.EqualFold(filepath.Ext(p), "."+ext) {
			p += "." + ext
		}
		return p
	}
	if z, err := exec.LookPath("zenity"); err == nil {
		out, err := command(z, "--file-selection", "--save", "--confirm-overwrite", "--title="+tr("Guardar como", "Save as"),
			"--filename="+start, "--file-filter="+desc+" | *."+ext, "--file-filter="+tr("Todos os ficheiros", "All files")+" | *").Output()
		if err == nil && strings.TrimSpace(string(out)) != "" {
			return fixExt(strings.TrimSpace(string(out))), true, ""
		}
		if ee, ok := err.(*exec.ExitError); ok && ee.ExitCode() == 1 {
			return "", false, "" // cancelado
		}
	}
	if k, err := exec.LookPath("kdialog"); err == nil {
		out, err := command(k, "--getsavefilename", start, "*."+ext+"|"+desc, "--title", tr("Guardar como", "Save as")).Output()
		if err == nil && strings.TrimSpace(string(out)) != "" {
			return fixExt(strings.TrimSpace(string(out))), true, ""
		}
		if ee, ok := err.(*exec.ExitError); ok && ee.ExitCode() == 1 {
			return "", false, ""
		}
	}
	p := autoSavePath(documentsDir(), name, ext)
	return p, true, tr("Não há janela \"Guardar como\" disponível (instala o zenity); o ficheiro foi gravado em Documentos/Digitalizações.",
		"No \"Save as\" window available (install zenity); the file was saved in Documents/Digitalizações.")
}
