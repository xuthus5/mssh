package service

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"strings"
	"sync"
	"time"

	msshssh "github.com/xuthus5/mssh/internal/ssh"
)

type aiAgentSFTPResult struct {
	output string
	err    error
}

func (connection *aiAgentSSH) executeSFTP(ctx context.Context, operation func() (string, error)) (string, error) {
	done := make(chan aiAgentSFTPResult, 1)
	go func() {
		output, err := operation()
		done <- aiAgentSFTPResult{output: output, err: err}
	}()
	select {
	case result := <-done:
		return result.output, result.err
	case <-ctx.Done():
		return "", errors.Join(ctx.Err(), connection.Close())
	}
}

func (connection *aiAgentSSH) listDir(request aiAgentToolRequest) (string, error) {
	entries, err := msshssh.ListDir(connection.sftp, request.Path)
	if err != nil {
		return "", err
	}
	limited, truncated, err := limitAIAgentDirectoryEntries(entries, request.MaxBytes)
	if err != nil {
		return "", err
	}
	data, err := json.Marshal(map[string]any{"entries": limited, "truncated": truncated})
	if err != nil {
		return "", fmt.Errorf("encode directory entries: %w", err)
	}
	return string(data), nil
}

func limitAIAgentDirectoryEntries(entries []msshssh.FileEntry, maxBytes int) ([]msshssh.FileEntry, bool, error) {
	limited := make([]msshssh.FileEntry, 0, len(entries))
	used := len(`{"entries":[],"truncated":true}`)
	for _, entry := range entries {
		encoded, err := json.Marshal(entry)
		if err != nil {
			return nil, false, fmt.Errorf("encode directory entry: %w", err)
		}
		if used+len(encoded)+1 > maxBytes {
			return limited, true, nil
		}
		limited = append(limited, entry)
		used += len(encoded) + 1
	}
	return limited, false, nil
}

func (connection *aiAgentSSH) stat(request aiAgentToolRequest) (string, error) {
	info, err := connection.sftp.Stat(request.Path)
	if err != nil {
		return "", fmt.Errorf("stat remote path: %w", err)
	}
	data, err := json.Marshal(map[string]any{"name": info.Name(), "size": info.Size(), "mode": info.Mode().String(), "is_dir": info.IsDir(), "mod_time": info.ModTime().Format(time.RFC3339)})
	if err != nil {
		return "", fmt.Errorf("encode remote file info: %w", err)
	}
	return string(data), nil
}

func (connection *aiAgentSSH) readFile(ctx context.Context, request aiAgentToolRequest) (string, error) {
	file, err := connection.sftp.Open(request.Path)
	if err != nil {
		return "", fmt.Errorf("open remote file: %w", err)
	}
	defer func() { _ = file.Close() }()
	reader := io.LimitReader(&contextReader{ctx: ctx, reader: file}, int64(request.MaxBytes)+1)
	data, err := io.ReadAll(reader)
	if err != nil {
		return "", fmt.Errorf("read remote file: %w", err)
	}
	truncated := len(data) > request.MaxBytes
	if truncated {
		data = data[:request.MaxBytes]
	}
	result, err := json.Marshal(map[string]any{"content": string(data), "truncated": truncated})
	if err != nil {
		return "", fmt.Errorf("encode remote file: %w", err)
	}
	return string(result), nil
}

func (connection *aiAgentSSH) writeFile(ctx context.Context, request aiAgentToolRequest) (string, error) {
	mode, err := connection.remoteWriteMode(request.Path)
	if err != nil {
		return "", err
	}
	tempPath, err := aiAgentRemoteTempPath(request.Path)
	if err != nil {
		return "", err
	}
	file, err := connection.sftp.OpenFile(tempPath, 0x1|0x40|0x80)
	if err != nil {
		return "", fmt.Errorf("create remote temporary file: %w", err)
	}
	cleanupTemp := true
	defer func() {
		if cleanupTemp {
			_ = connection.sftp.Remove(tempPath)
		}
	}()
	if err = file.Chmod(mode); err == nil {
		_, err = io.Copy(file, &contextReader{ctx: ctx, reader: strings.NewReader(request.Content)})
	}
	closeErr := file.Close()
	if err != nil {
		return "", errors.Join(fmt.Errorf("write remote temporary file: %w", err), closeErr)
	}
	if closeErr != nil {
		return "", fmt.Errorf("close remote temporary file: %w", closeErr)
	}
	if err = connection.sftp.PosixRename(tempPath, request.Path); err != nil {
		return "", fmt.Errorf("atomically replace remote file: %w", err)
	}
	cleanupTemp = false
	result, err := json.Marshal(map[string]any{"path": request.Path, "bytes_written": len(request.Content)})
	if err != nil {
		return "", fmt.Errorf("encode remote write result: %w", err)
	}
	return string(result), nil
}

func (connection *aiAgentSSH) remoteWriteMode(target string) (os.FileMode, error) {
	info, err := connection.sftp.Stat(target)
	if err == nil {
		if info.IsDir() {
			return 0, fmt.Errorf("remote write target is a directory")
		}
		return info.Mode().Perm(), nil
	}
	if os.IsNotExist(err) {
		return 0o600, nil
	}
	return 0, fmt.Errorf("stat remote write target: %w", err)
}

func aiAgentRemoteTempPath(target string) (string, error) {
	random := make([]byte, 8)
	if _, err := rand.Read(random); err != nil {
		return "", fmt.Errorf("generate remote temporary path: %w", err)
	}
	return path.Join(path.Dir(target), ".mssh-agent-"+hex.EncodeToString(random)+".tmp"), nil
}

type aiAgentBoundedBuffer struct {
	mu        sync.Mutex
	buffer    bytes.Buffer
	max       int
	truncated bool
}

func newAIAgentBoundedBuffer(maxBytes int) *aiAgentBoundedBuffer {
	return &aiAgentBoundedBuffer{max: maxBytes}
}

func (buffer *aiAgentBoundedBuffer) Write(data []byte) (int, error) {
	buffer.mu.Lock()
	defer buffer.mu.Unlock()
	original := len(data)
	remaining := max(buffer.max-buffer.buffer.Len(), 0)
	if len(data) > remaining {
		data, buffer.truncated = data[:remaining], true
	}
	_, err := buffer.buffer.Write(data)
	return original, err
}

func (buffer *aiAgentBoundedBuffer) String() string {
	buffer.mu.Lock()
	defer buffer.mu.Unlock()
	return buffer.buffer.String()
}

func (buffer *aiAgentBoundedBuffer) Truncated() bool {
	buffer.mu.Lock()
	defer buffer.mu.Unlock()
	return buffer.truncated
}

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (reader *contextReader) Read(data []byte) (int, error) {
	select {
	case <-reader.ctx.Done():
		return 0, reader.ctx.Err()
	default:
		return reader.reader.Read(data)
	}
}
