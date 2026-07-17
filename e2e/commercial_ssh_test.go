//go:build e2e

package e2e_test

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	gossh "golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"

	"github.com/xuthus5/mssh/internal/app"
	"github.com/xuthus5/mssh/internal/model"
)

type outputCapture struct {
	mu     sync.Mutex
	buffer strings.Builder
}

func (capture *outputCapture) append(data []byte) {
	capture.mu.Lock()
	_, _ = capture.buffer.Write(data)
	capture.mu.Unlock()
}

func (capture *outputCapture) contains(value string) bool {
	capture.mu.Lock()
	defer capture.mu.Unlock()
	return strings.Contains(capture.buffer.String(), value)
}

func TestCommercialSSHWorkflow(t *testing.T) {
	fixture := startSSHD(t)
	requireCommand(t, "tmux")
	appInstance, session := newFixtureSession(t, fixture)
	capture := &outputCapture{}
	appInstance.Terminal.SetOutputHandler(func(_ string, data []byte) { capture.append(data) })

	terminalID := openE2ETerminal(t, appInstance, session.ID)
	require.NoError(t, appInstance.Terminal.Resize(terminalID, 132, 43))
	writeAndWait(t, appInstance, capture, terminalID, "stty size; printf '__RESIZE_OK__\\n'\n", "43 132")
	writeAndWait(t, appInstance, capture, terminalID, "tmux -L mssh-e2e new-session -A -s main\n", "")
	writeAndWait(t, appInstance, capture, terminalID, "printf '__TMUX_OK__\\n'\n", "__TMUX_OK__")
	require.NoError(t, appInstance.Terminal.Close(terminalID))
	terminalID = openE2ETerminal(t, appInstance, session.ID)
	writeAndWait(t, appInstance, capture, terminalID, "printf '__RECONNECT_OK__\\n'\n", "__RECONNECT_OK__")

	remoteLarge := filepath.Join(os.TempDir(), "mssh-e2e-large.bin")
	remoteSmall := filepath.Join(os.TempDir(), "mssh-e2e-small.txt")
	defer func() {
		_ = os.Remove(remoteLarge)
		_ = os.Remove(remoteSmall)
		_ = exec.Command("tmux", "-L", "mssh-e2e", "kill-server").Run()
	}()
	require.NoError(t, os.WriteFile(remoteLarge, make([]byte, 64*1024*1024), 0o600))
	require.NoError(t, os.WriteFile(remoteSmall, []byte("recovered"), 0o600))
	destination := filepath.Join(t.TempDir(), "download.bin")
	require.NoError(t, os.WriteFile(destination, []byte("sentinel"), 0o600))
	taskID, err := appInstance.File.Download(session.ID, remoteLarge, destination)
	require.NoError(t, err)
	require.NoError(t, appInstance.File.CancelTransfer(taskID))
	waitTransferStatus(t, appInstance, taskID, "cancelled")
	content, err := os.ReadFile(destination)
	require.NoError(t, err)
	assert.Equal(t, "sentinel", string(content))
	assert.NoFileExists(t, destination+".partial")
	recoveryTask, err := appInstance.File.Download(session.ID, remoteSmall, destination)
	require.NoError(t, err)
	waitTransferStatus(t, appInstance, recoveryTask, "completed")
	content, err = os.ReadFile(destination)
	require.NoError(t, err)
	assert.Equal(t, "recovered", string(content))
	require.NoError(t, appInstance.Terminal.Close(terminalID))
}

func TestConcurrentResourcesReturnToBaseline(t *testing.T) {
	fixture := startSSHD(t)
	baseline := runtime.NumGoroutine()
	appInstance, session := newFixtureSession(t, fixture)
	remoteFile := filepath.Join(os.TempDir(), "mssh-e2e-resource.bin")
	require.NoError(t, os.WriteFile(remoteFile, make([]byte, 32*1024*1024), 0o600))
	defer func() { _ = os.Remove(remoteFile) }()
	for iteration := 0; iteration < 5; iteration++ {
		terminalID := openE2ETerminal(t, appInstance, session.ID)
		_, err := appInstance.Log.StartTerminalRecording(terminalID, session.ID, 80, 24, "xterm-256color")
		require.NoError(t, err)
		_, err = appInstance.Terminal.SystemInfo(terminalID)
		require.NoError(t, err)
		taskID, err := appInstance.File.Download(session.ID, remoteFile, filepath.Join(t.TempDir(), fmt.Sprintf("resource-%d.bin", iteration)))
		require.NoError(t, err)
		require.NoError(t, appInstance.File.CancelTransfer(taskID))
		waitTransferStatus(t, appInstance, taskID, "cancelled")
		require.NoError(t, appInstance.Terminal.Close(terminalID))
	}
	appInstance.Shutdown()
	assert.Zero(t, appInstance.Terminal.Count())
	assert.Zero(t, appInstance.Session.ConnectionCount())
	require.Eventually(t, func() bool { runtime.GC(); return runtime.NumGoroutine() <= baseline+8 }, 5*time.Second, 50*time.Millisecond, "goroutines did not return near baseline")
}

func newFixtureSession(t *testing.T, fixture sshdFixture) (*app.App, *model.Session) {
	t.Helper()
	dataDir := t.TempDir()
	hostKey, _, _, _, err := gossh.ParseAuthorizedKey(fixture.hostPublicKey)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(dataDir, "known_hosts"), []byte(knownhosts.Line([]string{fixture.address}, hostKey)+"\n"), 0o600))
	appInstance, err := app.New(app.Options{DataDir: dataDir, Logger: app.DefaultTestLogger(t)})
	require.NoError(t, err)
	t.Cleanup(appInstance.Shutdown)
	keyBytes, err := os.ReadFile(fixture.privateKey)
	require.NoError(t, err)
	key, err := appInstance.Key.Import("e2e-key", string(keyBytes))
	require.NoError(t, err)
	host, portText, err := net.SplitHostPort(fixture.address)
	require.NoError(t, err)
	var port int
	_, err = fmt.Sscan(portText, &port)
	require.NoError(t, err)
	session, err := appInstance.Session.CreateSession(model.SessionInput{Name: "commercial-e2e", Host: host, Port: port, Username: "root", AuthMethod: model.AuthKey, KeyID: &key.ID, KeepAlive: 30, TermType: "xterm-256color"})
	require.NoError(t, err)
	return appInstance, session
}

func openE2ETerminal(t *testing.T, appInstance *app.App, sessionID int64) string {
	t.Helper()
	terminalID, err := appInstance.Terminal.Open(context.Background(), sessionID, 80, 24)
	require.NoError(t, err)
	require.NoError(t, appInstance.Terminal.Attach(terminalID))
	return terminalID
}

func writeAndWait(t *testing.T, appInstance *app.App, capture *outputCapture, terminalID, command, marker string) {
	t.Helper()
	_, err := appInstance.Terminal.Write(terminalID, command)
	require.NoError(t, err)
	if marker == "" {
		time.Sleep(200 * time.Millisecond)
		return
	}
	require.Eventually(t, func() bool { return capture.contains(marker) }, 5*time.Second, 25*time.Millisecond)
}

func waitTransferStatus(t *testing.T, appInstance *app.App, taskID, status string) {
	t.Helper()
	require.Eventually(t, func() bool {
		jobs, err := appInstance.File.ListTransfers()
		if err != nil {
			return false
		}
		for _, job := range jobs {
			if job.ID == taskID {
				return job.Status == status
			}
		}
		return false
	}, 10*time.Second, 25*time.Millisecond)
}
