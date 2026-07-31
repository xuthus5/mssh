package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestParseConfigRequiresInputs(t *testing.T) {
	t.Setenv("MAKENSIS_NATIVE", "")
	_, err := parseConfig([]string{"-arch", "amd64"})
	if err == nil {
		t.Fatal("expected missing input error")
	}
}

func TestParseConfigMapsArchitectures(t *testing.T) {
	tmp := t.TempDir()
	cfg, err := parseConfig([]string{
		"-makensis", "makensis",
		"-arch", "arm64",
		"-binary", filepath.Join(tmp, "bin", "mssh.exe"),
		"-dir", filepath.Join(tmp, "build", "windows", "nsis"),
	})
	if err != nil {
		t.Fatalf("parse config: %v", err)
	}
	if cfg.argFlag != "ARM64" {
		t.Fatalf("arg flag mismatch: got %q", cfg.argFlag)
	}
	if !filepath.IsAbs(cfg.binary) || !filepath.IsAbs(cfg.dir) {
		t.Fatalf("paths must be absolute: binary=%q dir=%q", cfg.binary, cfg.dir)
	}
}

func TestParseConfigRejectsUnsupportedArchitecture(t *testing.T) {
	_, err := parseConfig([]string{
		"-makensis", "makensis",
		"-arch", "386",
		"-binary", "bin/mssh.exe",
		"-dir", "build/windows/nsis",
	})
	if err == nil {
		t.Fatal("expected unsupported arch error")
	}
}

func TestRunNSISInvokesMakensisWithoutShell(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture uses POSIX script")
	}
	tmp := t.TempDir()
	nsisDir := filepath.Join(tmp, "build", "windows", "nsis")
	binDir := filepath.Join(tmp, "bin")
	if err := os.MkdirAll(nsisDir, 0o700); err != nil {
		t.Fatalf("create nsis dir: %v", err)
	}
	if err := os.MkdirAll(binDir, 0o700); err != nil {
		t.Fatalf("create bin dir: %v", err)
	}
	fakeMakensis := filepath.Join(tmp, "makensis")
	argsFile := filepath.Join(tmp, "args.txt")
	cwdFile := filepath.Join(tmp, "cwd.txt")
	t.Setenv("NSIS_CWD_FILE", cwdFile)
	t.Setenv("NSIS_ARGS_FILE", argsFile)
	script := "#!/bin/sh\npwd > \"$NSIS_CWD_FILE\"\nprintf '%s\\n' \"$@\" > \"$NSIS_ARGS_FILE\"\n"
	if err := os.WriteFile(fakeMakensis, []byte(script), 0o700); err != nil {
		t.Fatalf("write fake makensis: %v", err)
	}
	binary := filepath.Join(binDir, "mssh.exe")
	if err := os.WriteFile(binary, []byte("binary"), 0o600); err != nil {
		t.Fatalf("write binary: %v", err)
	}
	err := runNSIS([]string{
		"-makensis", fakeMakensis,
		"-arch", "amd64",
		"-binary", binary,
		"-dir", nsisDir,
	})
	if err != nil {
		t.Fatalf("run nsis: %v", err)
	}
	cwdData, err := os.ReadFile(cwdFile)
	if err != nil {
		t.Fatalf("read cwd: %v", err)
	}
	if strings.TrimSpace(string(cwdData)) != nsisDir {
		t.Fatalf("cwd mismatch: got %q", strings.TrimSpace(string(cwdData)))
	}
	argsData, err := os.ReadFile(argsFile)
	if err != nil {
		t.Fatalf("read args: %v", err)
	}
	args := strings.Split(strings.TrimSpace(string(argsData)), "\n")
	wantDefine := "-DARG_WAILS_AMD64_BINARY=" + binary
	if len(args) != 2 || args[0] != wantDefine || args[1] != "project.nsi" {
		t.Fatalf("args mismatch: got %#v", args)
	}
}
