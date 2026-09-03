package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/pkg/sftp"
	gossh "golang.org/x/crypto/ssh"

	"github.com/xuthus5/mssh/internal/model"
	msshssh "github.com/xuthus5/mssh/internal/ssh"
)

type aiAgentToolRequest struct {
	Name     string
	Command  string
	Path     string
	Content  string
	Risk     model.AICommandRisk
	Approval model.AIAgentApprovalStatus
	Blocked  string
	MaxBytes int
	Timeout  time.Duration
}

type aiAgentSSH struct {
	client    *msshssh.ClientWrapper
	sftp      *sftp.Client
	cleanup   func()
	closeOnce sync.Once
	closeErr  error
}

func (s *AIService) openAIAgentSSH(ctx context.Context, sessionID int64) (*aiAgentSSH, error) {
	client, cleanup, err := s.sessions.openAIAgentConnection(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	sftpClient, err := msshssh.OpenSFTP(client)
	if err != nil {
		if cleanup != nil {
			cleanup()
		}
		return nil, errors.Join(err, client.Close())
	}
	return &aiAgentSSH{client: client, sftp: sftpClient, cleanup: cleanup}, nil
}

func (connection *aiAgentSSH) Close() error {
	if connection == nil {
		return nil
	}
	connection.closeOnce.Do(func() {
		var sftpErr, clientErr error
		if connection.sftp != nil {
			sftpErr = connection.sftp.Close()
		}
		if connection.client != nil {
			clientErr = connection.client.Close()
		}
		if connection.cleanup != nil {
			connection.cleanup()
		}
		connection.closeErr = errors.Join(sftpErr, clientErr)
	})
	return connection.closeErr
}

func prepareAIAgentToolRequest(action aiAgentAction, security model.AISecuritySettings) (aiAgentToolRequest, error) {
	request := aiAgentToolRequest{Name: action.Tool, Risk: model.AICommandRiskReadOnly, Approval: model.AIAgentApprovalNotRequired, MaxBytes: security.MaxOutputBytes, Timeout: time.Duration(security.CommandTimeoutSeconds) * time.Second}
	switch action.Tool {
	case "ssh.exec":
		var args struct {
			Command string `json:"command"`
		}
		if err := decodeAIAgentArguments(action.Arguments, &args); err != nil {
			return request, err
		}
		request.Command = strings.TrimSpace(args.Command)
		proposal := classifyAICommand(request.Command, security)
		request.Risk = proposal.Risk
		if proposal.Blocked {
			request.Blocked = proposal.BlockedReason
		} else if proposal.Risk != model.AICommandRiskReadOnly {
			request.Approval = model.AIAgentApprovalPending
		}
	case "ssh.list_dir", "ssh.stat", "ssh.read_file":
		var args struct {
			Path string `json:"path"`
		}
		if err := decodeAIAgentArguments(action.Arguments, &args); err != nil {
			return request, err
		}
		validated, err := validateAIAgentRemotePath(args.Path)
		if err != nil {
			return request, err
		}
		request.Path = validated
	case "ssh.write_file":
		var args struct {
			Path    string `json:"path"`
			Content string `json:"content"`
		}
		if err := decodeAIAgentArguments(action.Arguments, &args); err != nil {
			return request, err
		}
		validated, err := validateAIAgentWritePath(args.Path)
		if err != nil {
			return request, err
		}
		if len(args.Content) > security.MaxOutputBytes {
			return request, fmt.Errorf("AI agent file content exceeds %d bytes", security.MaxOutputBytes)
		}
		request.Path, request.Content = validated, args.Content
		request.Risk, request.Approval = model.AICommandRiskModify, model.AIAgentApprovalPending
	default:
		return request, fmt.Errorf("unsupported AI agent tool %s", action.Tool)
	}
	return request, nil
}

func validateAIAgentRemotePath(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || strings.ContainsRune(value, 0) {
		return "", fmt.Errorf("remote path is required")
	}
	if !path.IsAbs(value) {
		return "", fmt.Errorf("remote path must be absolute")
	}
	cleaned := path.Clean(value)
	if cleaned == "/" {
		return "", fmt.Errorf("remote root path is not allowed")
	}
	return cleaned, nil
}

func validateAIAgentWritePath(value string) (string, error) {
	cleaned, err := validateAIAgentRemotePath(value)
	if err != nil {
		return "", err
	}
	if isProtectedAIAgentPath(cleaned) {
		return "", fmt.Errorf("remote path is protected from AI writes")
	}
	return cleaned, nil
}

func isProtectedAIAgentPath(value string) bool {
	protectedRoots := []string{"/boot", "/dev", "/etc", "/proc", "/root", "/sys", "/usr", "/var/lib", "/var/run"}
	for _, root := range protectedRoots {
		if value == root || strings.HasPrefix(value, root+"/") {
			return true
		}
	}
	for _, component := range strings.Split(strings.TrimPrefix(value, "/"), "/") {
		if component == ".ssh" || component == ".gnupg" {
			return true
		}
	}
	return false
}

func (connection *aiAgentSSH) Execute(ctx context.Context, request aiAgentToolRequest) (string, error) {
	operationCtx, cancel := context.WithTimeout(ctx, request.Timeout)
	defer cancel()
	switch request.Name {
	case "ssh.exec":
		return connection.exec(operationCtx, request)
	case "ssh.list_dir":
		return connection.executeSFTP(operationCtx, func() (string, error) { return connection.listDir(request) })
	case "ssh.stat":
		return connection.executeSFTP(operationCtx, func() (string, error) { return connection.stat(request) })
	case "ssh.read_file":
		return connection.executeSFTP(operationCtx, func() (string, error) { return connection.readFile(operationCtx, request) })
	case "ssh.write_file":
		return connection.executeSFTP(operationCtx, func() (string, error) { return connection.writeFile(operationCtx, request) })
	default:
		return "", fmt.Errorf("unsupported AI agent tool %s", request.Name)
	}
}

func (connection *aiAgentSSH) exec(ctx context.Context, request aiAgentToolRequest) (string, error) {
	session, err := connection.client.Inner.NewSession()
	if err != nil {
		return "", fmt.Errorf("open SSH command channel: %w", err)
	}
	defer func() { _ = session.Close() }()
	stdout := newAIAgentBoundedBuffer(request.MaxBytes)
	stderr := newAIAgentBoundedBuffer(request.MaxBytes)
	session.Stdout, session.Stderr = stdout, stderr
	done := make(chan error, 1)
	go func() { done <- session.Run(request.Command) }()
	var runErr error
	select {
	case runErr = <-done:
	case <-ctx.Done():
		_ = session.Close()
		runErr = ctx.Err()
	}
	exitCode := 0
	if runErr != nil {
		var exitErr *gossh.ExitError
		if errors.As(runErr, &exitErr) {
			exitCode = exitErr.ExitStatus()
		} else {
			exitCode = -1
		}
	}
	result, marshalErr := json.Marshal(map[string]any{"stdout": stdout.String(), "stderr": stderr.String(), "exit_code": exitCode, "truncated": stdout.Truncated() || stderr.Truncated()})
	if marshalErr != nil {
		return "", fmt.Errorf("encode SSH command result: %w", marshalErr)
	}
	if runErr != nil {
		return string(result), fmt.Errorf("SSH command failed: %w", runErr)
	}
	return string(result), nil
}
