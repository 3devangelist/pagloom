//go:build linux

// Verificação e instalação das dependências do SANE na primeira utilização.
package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func hasAirscan() bool {
	if _, err := os.Stat("/etc/sane.d/airscan.conf"); err == nil {
		return true
	}
	for _, pat := range []string{"/usr/lib/*/sane/libsane-airscan.so*", "/usr/lib/sane/libsane-airscan.so*", "/usr/lib64/sane/libsane-airscan.so*"} {
		if m, _ := filepath.Glob(pat); len(m) > 0 {
			return true
		}
	}
	return false
}

func packageManager() string {
	for _, pm := range []string{"apt-get", "dnf", "zypper", "pacman"} {
		if _, err := exec.LookPath(pm); err == nil {
			return pm
		}
	}
	return ""
}

func depsStatus() DepState {
	st := DepState{PM: packageManager()}
	if mockMode() {
		st.OK = true
		return st
	}
	_, errSI := exec.LookPath("scanimage")
	air := hasAirscan()
	var utils []string
	airPkg := "sane-airscan"
	switch st.PM {
	case "apt-get": // Ubuntu, Debian, Mint, Raspberry Pi OS
		utils = []string{"sane-utils"}
	case "dnf": // Fedora, RHEL
		utils = []string{"sane-backends", "sane-backends-drivers-scanners"}
	case "zypper": // openSUSE
		utils = []string{"sane-backends"}
	case "pacman": // Arch, Manjaro
		utils = []string{"sane"}
	}
	if errSI != nil {
		st.Missing = append(st.Missing, "SANE (scanimage)")
		st.Packages = append(st.Packages, utils...)
	}
	if !air {
		st.Missing = append(st.Missing, "sane-airscan (scanners de rede)")
		st.Packages = append(st.Packages, airPkg)
	}
	st.OK = len(st.Missing) == 0
	st.Command = simpleCommand(st.PM, st.Packages)
	return st
}

func installCommand(pm string, pkgs []string, sudo bool) string {
	if len(pkgs) == 0 || pm == "" || pkgs[0] == "" {
		return ""
	}
	p := strings.Join(pkgs, " ")
	s := ""
	if sudo {
		s = "sudo "
	}
	switch pm {
	case "apt-get":
		return s + "apt-get update && " + s + "env DEBIAN_FRONTEND=noninteractive apt-get install -y " + p
	case "dnf":
		return s + "dnf install -y " + p
	case "zypper":
		return s + "zypper --non-interactive install " + p
	case "pacman":
		return s + "pacman -S --needed --noconfirm " + p
	}
	return ""
}

// Instala com pkexec (pede a palavra-passe numa janela). Sem pkexec, abre um terminal com sudo.
func installDeps() (string, error) {
	st := depsStatus()
	if st.OK {
		return "Já está tudo instalado.", nil
	}
	if st.PM == "" {
		return "", fmt.Errorf("não encontrei apt, dnf, zypper nem pacman — instala o SANE e o sane-airscan manualmente")
	}
	cmdline := installCommand(st.PM, st.Packages, false)
	if pk, err := exec.LookPath("pkexec"); err == nil {
		out, err := command(pk, "sh", "-c", cmdline).CombinedOutput()
		if err == nil {
			markDeps("ok")
			return "Instalado: " + strings.Join(st.Packages, ", ") + ".", nil
		}
		if ee, ok := err.(*exec.ExitError); ok && (ee.ExitCode() == 126 || ee.ExitCode() == 127) {
			return "", fmt.Errorf("instalação cancelada")
		}
		lines := strings.Split(strings.TrimSpace(string(out)), "\n")
		return "", fmt.Errorf("a instalação falhou: %s", lines[len(lines)-1])
	}
	// Sem pkexec: terminal com sudo
	script := filepath.Join(tmpDir, "instalar-sane.sh")
	os.WriteFile(script, []byte("#!/bin/sh\necho 'Pagloom: a instalar "+strings.Join(st.Packages, " ")+"'\n"+
		installCommand(st.PM, st.Packages, true)+"\necho\necho 'Terminado. Volta ao Pagloom e carrega em ↻.'\nread -r _\n"), 0755)
	for _, t := range [][]string{
		{"x-terminal-emulator", "-e"}, {"gnome-terminal", "--"}, {"konsole", "-e"}, {"xfce4-terminal", "-x"},
		{"mate-terminal", "-x"}, {"tilix", "-e"}, {"kitty"}, {"alacritty", "-e"}, {"xterm", "-e"},
	} {
		if p, err := exec.LookPath(t[0]); err == nil {
			args := append(t[1:], "sh", script)
			if err := command(p, args...).Start(); err == nil {
				return "Abri um terminal para a instalação. Quando terminar, carrega em ↻.", nil
			}
		}
	}
	return "", fmt.Errorf("não consegui abrir um terminal — corre: %s", st.Command)
}

func depsMarker() string {
	cfg, _ := os.UserConfigDir()
	return filepath.Join(cfg, "Pagloom", "dependencias")
}
func markDeps(v string) {
	os.MkdirAll(filepath.Dir(depsMarker()), 0755)
	os.WriteFile(depsMarker(), []byte(v), 0644)
}

// Primeira utilização: se faltar algo, pergunta e instala antes de abrir a janela.
func platformInit() {
	st := depsStatus()
	if st.OK {
		return
	}
	if b, err := os.ReadFile(depsMarker()); err == nil && strings.TrimSpace(string(b)) == "recusado" {
		return // o utilizador já disse que não; a interface continua a mostrar o botão "Instalar"
	}
	msg := "Para usar o scanner falta instalar:\n\n  • " + strings.Join(st.Missing, "\n  • ") +
		"\n\nQueres instalar agora? Vai ser pedida a tua palavra-passe."
	ans := ask(msg)
	if ans == 0 {
		return // sem diálogo disponível: a interface trata disso
	}
	if ans < 0 {
		markDeps("recusado")
		return
	}
	if res, err := installDeps(); err != nil {
		info("Não foi possível instalar: " + err.Error() + "\n\nPodes tentar de novo no separador Digitalizar.")
	} else {
		info(res)
	}
}

// ask devolve 1 (sim), -1 (não) ou 0 (sem diálogo gráfico).
func ask(msg string) int {
	if z, err := exec.LookPath("zenity"); err == nil {
		err := command(z, "--question", "--title=Pagloom", "--width=420", "--ok-label=Instalar", "--cancel-label=Agora não", "--text="+msg).Run()
		return answer(err)
	}
	if k, err := exec.LookPath("kdialog"); err == nil {
		return answer(command(k, "--title", "Pagloom", "--yesno", msg).Run())
	}
	return 0
}

func info(msg string) {
	if z, err := exec.LookPath("zenity"); err == nil {
		command(z, "--info", "--title=Pagloom", "--width=420", "--text="+msg).Run()
	} else if k, err := exec.LookPath("kdialog"); err == nil {
		command(k, "--title", "Pagloom", "--msgbox", msg).Run()
	}
}

func answer(err error) int {
	if err == nil {
		return 1
	}
	if ee, ok := err.(*exec.ExitError); ok && ee.ExitCode() == 1 {
		return -1
	}
	return 0 // o diálogo não abriu (sem ecrã, etc.)
}

func simpleCommand(pm string, pkgs []string) string {
	if len(pkgs) == 0 || pm == "" {
		return ""
	}
	p := strings.Join(pkgs, " ")
	switch pm {
	case "apt-get":
		return "sudo apt install " + p
	case "dnf":
		return "sudo dnf install " + p
	case "zypper":
		return "sudo zypper install " + p
	case "pacman":
		return "sudo pacman -S " + p
	}
	return ""
}
