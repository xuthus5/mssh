package service

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

const revealCommandTimeout = 5 * time.Second

type revealCommand struct {
	name            string
	args            []string
	ignoreExitError bool
}

type revealCommandRunner func(string, []string) error

// RevealTransfer shows a completed download in the platform file manager.
func (f *FileService) RevealTransfer(taskID string) error {
	if strings.TrimSpace(taskID) == "" {
		return fmt.Errorf("invalid task id")
	}
	finish, err := f.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	if f.db == nil {
		return fmt.Errorf("transfer database unavailable")
	}
	f.reconcilePendingTransferFinalizations()
	job, err := store.GetTransferJob(f.db, taskID)
	if err != nil {
		return fmt.Errorf("reveal transfer: %w", err)
	}
	jobs := f.overlayPendingTransferFinalizations([]model.TransferJob{job})
	job = jobs[0]
	if job.Direction != "download" {
		return fmt.Errorf("only downloaded files can be revealed")
	}
	if job.Status != "completed" {
		return fmt.Errorf("transfer %s is not completed", taskID)
	}
	targetPath, err := validateRevealTarget(job.TargetPath)
	if err != nil {
		return fmt.Errorf("reveal transfer: %w", err)
	}
	f.logger.Info("revealing transfer file", "taskID", taskID, "path", targetPath)
	if err := f.transferOperations.revealLocal(targetPath); err != nil {
		return fmt.Errorf("reveal transfer: %w", err)
	}
	return nil
}

func validateRevealTarget(path string) (string, error) {
	cleaned, err := validateLocalTransferPath(path)
	if err != nil {
		return "", err
	}
	if !filepath.IsAbs(cleaned) {
		return "", fmt.Errorf("local path must be absolute")
	}
	info, err := os.Stat(cleaned)
	if errors.Is(err, os.ErrNotExist) {
		return "", fmt.Errorf("local file does not exist")
	}
	if err != nil {
		return "", fmt.Errorf("stat local file: %w", err)
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("local path must be a regular file")
	}
	return cleaned, nil
}

func revealLocalFile(path string) error {
	return revealFileInManagerWith(runtime.GOOS, path, runRevealCommand)
}

func revealFileInManagerWith(goos, path string, runner revealCommandRunner) error {
	commands, err := revealFileCommands(goos, path)
	if err != nil {
		return err
	}
	failures := make([]error, 0, len(commands))
	for _, command := range commands {
		err := runner(command.name, command.args)
		if err == nil {
			return nil
		}
		if command.ignoreExitError && isPositiveProcessExit(err) {
			return nil
		}
		failures = append(failures, fmt.Errorf("%s: %w", command.name, err))
	}
	return errors.Join(failures...)
}

func revealFileCommands(goos, path string) ([]revealCommand, error) {
	switch goos {
	case "windows":
		return []revealCommand{{name: "explorer.exe", args: []string{"/select," + path}, ignoreExitError: true}}, nil
	case "darwin":
		return []revealCommand{{name: "open", args: []string{"-R", path}}}, nil
	case "linux":
		return linuxRevealCommands(path), nil
	default:
		return nil, fmt.Errorf("reveal is unsupported on %s", goos)
	}
}

func linuxRevealCommands(path string) []revealCommand {
	fileURI := (&url.URL{Scheme: "file", Path: path}).String()
	return []revealCommand{
		{
			name: "dbus-send",
			args: []string{
				"--session", "--dest=org.freedesktop.FileManager1", "--type=method_call",
				"/org/freedesktop/FileManager1", "org.freedesktop.FileManager1.ShowItems",
				"array:string:" + fileURI, "string:",
			},
		},
		{name: "xdg-open", args: []string{filepath.Dir(path)}},
	}
}

func runRevealCommand(name string, args []string) error {
	ctx, cancel := context.WithTimeout(context.Background(), revealCommandTimeout)
	defer cancel()
	return exec.CommandContext(ctx, name, args...).Run()
}

func isPositiveProcessExit(err error) bool {
	var exitError *exec.ExitError
	return errors.As(err, &exitError) && exitError.ExitCode() > 0
}
