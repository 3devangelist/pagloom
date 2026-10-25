//go:build !windows && !linux

package main

import "fmt"

func startSTA()                                                     {}
func fatal(msg string)                                              { fmt.Println(msg) }
func reveal(path string)                                            {}
func openURL(url string)                                            { fmt.Println("URL:", url) }
func runWindow(url string) bool                                     { return false }
func listDevices() ([]Device, error)                                { return mockDevices() }
func scan(o ScanOptions) ([]ScannedPage, error)                     { return mockScan(o) }
func saveDialog(name, ext, desc, dir string) (string, bool, string) { return "", false, "" }
func memInfo() (total, avail uint64)                                { return 0, 0 }
