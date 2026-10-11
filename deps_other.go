//go:build !linux

package main

func platformInit()                {}
func depsStatus() DepState         { return DepState{OK: true} }
func installDeps() (string, error) { return "Nada a instalar.", nil }
