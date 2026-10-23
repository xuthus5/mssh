package service

import (
	"fmt"
	"strings"
)

func writeStartupCommand(pty terminalIO, command string) error {
	payload := startupCommandPayload(command)
	if payload == "" {
		return nil
	}
	if _, err := pty.Write([]byte(payload)); err != nil {
		return fmt.Errorf("write command: %w", err)
	}
	return nil
}

func startupCommandPayload(command string) string {
	command = strings.ReplaceAll(command, "\r\n", "\n")
	command = strings.ReplaceAll(command, "\r", "\n")
	command = strings.TrimRight(command, "\n")
	if command == "" {
		return ""
	}
	return command + "\n"
}
