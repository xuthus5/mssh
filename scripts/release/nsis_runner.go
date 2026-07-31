package main

import (
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

func main() {
	if err := runNSIS(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func runNSIS(args []string) error {
	cfg, err := parseConfig(args)
	if err != nil {
		return err
	}
	cmd := exec.Command(
		cfg.makensis,
		"-DARG_WAILS_"+cfg.argFlag+"_BINARY="+cfg.binary,
		"project.nsi",
	)
	cmd.Dir = cfg.dir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

type nsisConfig struct {
	makensis string
	arch     string
	argFlag  string
	binary   string
	dir      string
}

func parseConfig(args []string) (nsisConfig, error) {
	fs := flag.NewFlagSet("nsis_runner", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	cfg := nsisConfig{}
	fs.StringVar(&cfg.makensis, "makensis", os.Getenv("MAKENSIS_NATIVE"), "path to makensis.exe")
	fs.StringVar(&cfg.arch, "arch", "", "target architecture")
	fs.StringVar(&cfg.binary, "binary", "", "path to built Windows binary")
	fs.StringVar(&cfg.dir, "dir", "", "NSIS project directory")
	if err := fs.Parse(args); err != nil {
		return cfg, err
	}
	return validateConfig(cfg)
}

func validateConfig(cfg nsisConfig) (nsisConfig, error) {
	if cfg.makensis == "" || cfg.binary == "" || cfg.dir == "" {
		return cfg, fmt.Errorf("makensis, binary and dir are required")
	}
	switch cfg.arch {
	case "amd64":
		cfg.argFlag = "AMD64"
	case "arm64":
		cfg.argFlag = "ARM64"
	default:
		return cfg, fmt.Errorf("unsupported arch %q", cfg.arch)
	}
	binary, err := filepath.Abs(cfg.binary)
	if err != nil {
		return cfg, fmt.Errorf("resolve binary path: %w", err)
	}
	dir, err := filepath.Abs(cfg.dir)
	if err != nil {
		return cfg, fmt.Errorf("resolve nsis dir: %w", err)
	}
	cfg.binary = filepath.Clean(binary)
	cfg.dir = filepath.Clean(dir)
	return cfg, nil
}
