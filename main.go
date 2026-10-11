package main

import (
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

//go:embed web
var webFS embed.FS

var (
	token    string
	tmpDir   string
	imgMu    sync.Mutex
	images   = map[string]string{} // id -> ficheiro temporário
	dirsMu   sync.Mutex
	okDirs   = map[string]bool{} // pastas escolhidas pelo utilizador (escrita permitida)
	lastPing = time.Now()
	pingMu   sync.Mutex
)

func randHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func settingsPath() string {
	base := os.Getenv("APPDATA")
	if base == "" {
		base, _ = os.UserConfigDir()
	}
	return filepath.Join(base, "Pagloom", "settings.json")
}

func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(v)
}

func errJSON(w http.ResponseWriter, err error) {
	code := ""
	if c, ok := err.(interface{ HResult() string }); ok {
		code = c.HResult()
	}
	writeJSON(w, map[string]string{"error": err.Error(), "code": code})
}

func addImage(path string) string {
	id := randHex(8)
	imgMu.Lock()
	images[id] = path
	imgMu.Unlock()
	return id
}

func api(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Token") != token && r.URL.Query().Get("t") != token {
		http.Error(w, "forbidden", 403)
		return
	}
	p := strings.TrimPrefix(r.URL.Path, "/api/")
	q := r.URL.Query()
	switch {
	case p == "ping":
		pingMu.Lock()
		lastPing = time.Now()
		pingMu.Unlock()
		writeJSON(w, map[string]bool{"ok": true})

	case p == "info":
		writeJSON(w, map[string]interface{}{"os": runtime.GOOS, "driverUI": runtime.GOOS == "windows"})

	case p == "deps":
		writeJSON(w, depsStatus())

	case p == "deps/install":
		msg, err := installDeps()
		if err != nil {
			errJSON(w, err)
			return
		}
		writeJSON(w, map[string]interface{}{"message": msg, "state": depsStatus()})

	case p == "devices":
		devs, err := listDevices()
		if err != nil {
			errJSON(w, err)
			return
		}
		writeJSON(w, map[string]interface{}{"devices": devs})

	case p == "scan":
		var o ScanOptions
		if err := json.NewDecoder(r.Body).Decode(&o); err != nil {
			errJSON(w, err)
			return
		}
		pages, err := scan(o)
		if err != nil && len(pages) == 0 {
			errJSON(w, err)
			return
		}
		res := map[string]interface{}{"pages": pages}
		if err != nil {
			res["warning"] = err.Error()
		}
		writeJSON(w, res)

	case strings.HasPrefix(p, "img/"):
		id := strings.TrimPrefix(p, "img/")
		imgMu.Lock()
		path, ok := images[id]
		imgMu.Unlock()
		if !ok {
			http.NotFound(w, r)
			return
		}
		if r.Method == http.MethodDelete {
			os.Remove(path)
			imgMu.Lock()
			delete(images, id)
			imgMu.Unlock()
			writeJSON(w, map[string]bool{"ok": true})
			return
		}
		http.ServeFile(w, r, path)

	case p == "choose": // escolher ficheiro de destino
		path, ok, note := saveDialog(q.Get("name"), q.Get("ext"), q.Get("desc"), lastDir())
		if !ok {
			writeJSON(w, map[string]bool{"cancelled": true})
			return
		}
		dirsMu.Lock()
		okDirs[strings.ToLower(filepath.Dir(path))] = true
		dirsMu.Unlock()
		rememberDir(filepath.Dir(path))
		writeJSON(w, map[string]string{"path": path, "dir": filepath.Dir(path), "note": note})

	case p == "write":
		path := filepath.Clean(q.Get("path"))
		dirsMu.Lock()
		allowed := okDirs[strings.ToLower(filepath.Dir(path))]
		dirsMu.Unlock()
		if !allowed || !filepath.IsAbs(path) {
			http.Error(w, "caminho não autorizado", 403)
			return
		}
		f, err := os.Create(path)
		if err != nil {
			errJSON(w, err)
			return
		}
		_, err = io.Copy(f, r.Body)
		f.Close()
		if err != nil {
			errJSON(w, err)
			return
		}
		writeJSON(w, map[string]string{"path": path})

	case p == "exists":
		_, err := os.Stat(q.Get("path"))
		writeJSON(w, map[string]bool{"exists": err == nil})

	case p == "reveal":
		reveal(q.Get("path"))
		writeJSON(w, map[string]bool{"ok": true})

	case p == "settings":
		if r.Method == http.MethodPost {
			b, _ := io.ReadAll(r.Body)
			os.MkdirAll(filepath.Dir(settingsPath()), 0755)
			os.WriteFile(settingsPath(), b, 0644)
			writeJSON(w, map[string]bool{"ok": true})
			return
		}
		b, err := os.ReadFile(settingsPath())
		if err != nil {
			b = []byte("{}")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(b)

	default:
		http.NotFound(w, r)
	}
}

var dirMu sync.Mutex
var curDir string

func lastDir() string {
	dirMu.Lock()
	defer dirMu.Unlock()
	return curDir
}
func rememberDir(d string) {
	dirMu.Lock()
	curDir = d
	dirMu.Unlock()
}

func noCache(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		h.ServeHTTP(w, r)
	})
}

func main() {
	mime.AddExtensionType(".mjs", "text/javascript")
	mime.AddExtensionType(".js", "text/javascript")
	var err error
	tmpDir, err = os.MkdirTemp("", "Pagloom_")
	if err != nil {
		fatal("Não foi possível criar a pasta temporária: " + err.Error())
	}
	defer os.RemoveAll(tmpDir)
	token = randHex(16)

	port := os.Getenv("PAGLOOM_PORT")
	if port == "" {
		port = "0"
	}
	ln, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		fatal("Não foi possível abrir o servidor local: " + err.Error())
	}
	sub, _ := fs.Sub(webFS, "web")
	mux := http.NewServeMux()
	mux.Handle("/", noCache(http.FileServer(http.FS(sub))))
	mux.HandleFunc("/api/", api)
	go http.Serve(ln, mux)

	url := fmt.Sprintf("http://127.0.0.1:%d/?t=%s", ln.Addr().(*net.TCPAddr).Port, token)
	if os.Getenv("PAGLOOM_TOKEN") != "" { // só para testes
		token = os.Getenv("PAGLOOM_TOKEN")
		url = fmt.Sprintf("http://127.0.0.1:%d/?t=%s", ln.Addr().(*net.TCPAddr).Port, token)
	}
	platformInit()
	startSTA()
	if !runWindow(url) {
		// Sem WebView2: abre no browser predefinido e fica ativo enquanto a página estiver aberta.
		openURL(url)
		waitHeartbeat()
	}
}

// Fica ativo enquanto a página der sinal de vida.
func waitHeartbeat() {
	pingMu.Lock()
	lastPing = time.Now()
	pingMu.Unlock()
	for {
		time.Sleep(5 * time.Second)
		pingMu.Lock()
		idle := time.Since(lastPing)
		pingMu.Unlock()
		if idle > 60*time.Second {
			return
		}
	}
}
