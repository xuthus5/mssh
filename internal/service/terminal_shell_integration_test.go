package service

import (
	"context"
	"errors"
	"runtime"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	msshssh "github.com/xuthus5/mssh/internal/ssh"
	sshtestutil "github.com/xuthus5/mssh/internal/ssh/testutil"
	"github.com/xuthus5/mssh/internal/store"
	"github.com/xuthus5/mssh/pkg/event"
)

func TestDetectTerminalShellIntegrationRejectsUnavailableClient(t *testing.T) {
	_, ok, err := detectTerminalShellIntegration(nil)
	require.False(t, ok)
	require.ErrorContains(t, err, "detect shell")
}

func TestInstallTerminalDirectoryIntegrationForWrapperRejectsUnavailableClient(t *testing.T) {
	_, managed, err := installTerminalDirectoryIntegrationForWrapper(nil, shellIntegrationBash)
	require.False(t, managed)
	require.ErrorContains(t, err, "install terminal directory integration")
}

func TestTerminalDirectoryIntegrationEnabledHandlesMissingAndMalformedSettings(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	service := NewTerminalService(sessionSvc, newMockEventBus(), 2, testutil.NewTestLogger())
	require.False(t, service.terminalDirectoryIntegrationEnabled())
	require.NoError(t, store.SetSettings(db, []model.Setting{{
		Key: sftpFollowTerminalDirectorySettingKey, Namespace: "sftp",
		Value: `"not-json"`, ValueType: "string", Version: 1,
	}}))
	require.False(t, service.terminalDirectoryIntegrationEnabled())
}

func TestTerminalServiceLoggerUsesDefaultForNilService(t *testing.T) {
	require.NotNil(t, terminalServiceLogger(nil))
}

func TestTerminalServiceStartDirectoryIntegrationSkipsWhenSettingDisabled(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	service := NewTerminalService(sessionSvc, newMockEventBus(), 2, testutil.NewTestLogger())
	restore := replaceTerminalDirectoryIntegrationSeams(t,
		func(*msshssh.ClientWrapper) (shellIntegration, bool, error) {
			t.Fatal("shell detection should not run when SFTP follow is disabled")
			return "", false, nil
		},
		func(*msshssh.ClientWrapper, shellIntegration) (string, bool, error) {
			t.Fatal("installer should not run when SFTP follow is disabled")
			return "", false, nil
		},
	)
	defer restore()

	started := service.startTerminalDirectoryIntegration(1)

	require.False(t, started)
}

func TestTerminalServiceStartDirectoryIntegrationInstallsDetectedShell(t *testing.T) {
	sessionSvc, service, created, cleanup := newDirectoryIntegrationTestHarness(t, true)
	defer cleanup()
	installed := make(chan shellIntegration, 1)
	restore := replaceTerminalDirectoryIntegrationSeams(t,
		func(*msshssh.ClientWrapper) (shellIntegration, bool, error) {
			return shellIntegrationZsh, true, nil
		},
		func(_ *msshssh.ClientWrapper, shell shellIntegration) (string, bool, error) {
			installed <- shell
			return "/home/deploy/.zshrc", true, nil
		},
	)
	defer restore()

	started := service.startTerminalDirectoryIntegration(created.ID)

	require.True(t, started)
	waitForTerminalDirectoryIntegration(t, service)
	require.Equal(t, shellIntegrationZsh, <-installed)
	require.Equal(t, 0, sessionSvc.ConnectionCount())
}

func TestTerminalServiceDirectoryIntegrationErrorDoesNotAffectTerminal(t *testing.T) {
	sessionSvc, service, created, cleanup := newDirectoryIntegrationTestHarness(t, true)
	defer cleanup()
	restore := replaceTerminalDirectoryIntegrationSeams(t,
		func(*msshssh.ClientWrapper) (shellIntegration, bool, error) {
			return shellIntegrationBash, true, nil
		},
		func(*msshssh.ClientWrapper, shellIntegration) (string, bool, error) {
			return "", false, errors.New("permission denied")
		},
	)
	defer restore()

	terminalID, err := service.Open(context.Background(), created.ID, 80, 24)
	require.NoError(t, err)
	waitForTerminalDirectoryIntegration(t, service)

	require.Equal(t, 1, service.Count())
	require.Equal(t, 1, sessionSvc.ConnectionCount())
	require.NoError(t, service.Close(terminalID))
	require.Equal(t, 0, sessionSvc.ConnectionCount())
}

func TestTerminalServiceDirectoryIntegrationSkipsUnsupportedShell(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	service := NewTerminalService(sessionSvc, newMockEventBus(), 2, testutil.NewTestLogger())
	restore := replaceTerminalDirectoryIntegrationSeams(t,
		func(*msshssh.ClientWrapper) (shellIntegration, bool, error) {
			return "", false, nil
		},
		func(*msshssh.ClientWrapper, shellIntegration) (string, bool, error) {
			t.Fatal("installer should not run for unsupported shells")
			return "", false, nil
		},
	)
	defer restore()

	service.runTerminalDirectoryIntegrationWithWrapper(1, &msshssh.ClientWrapper{})
}

func TestTerminalServiceDirectoryIntegrationHandlesDetectionError(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	service := NewTerminalService(sessionSvc, newMockEventBus(), 2, testutil.NewTestLogger())
	restore := replaceTerminalDirectoryIntegrationSeams(t,
		func(*msshssh.ClientWrapper) (shellIntegration, bool, error) {
			return "", false, errors.New("shell unavailable")
		},
		func(*msshssh.ClientWrapper, shellIntegration) (string, bool, error) {
			t.Fatal("installer should not run after shell detection failure")
			return "", false, nil
		},
	)
	defer restore()

	service.runTerminalDirectoryIntegrationWithWrapper(1, &msshssh.ClientWrapper{})
}

func TestTerminalServiceDirectoryIntegrationUsesDedicatedConnection(t *testing.T) {
	sessionSvc, service, created, cleanup := newDirectoryIntegrationTestHarness(t, true)
	defer cleanup()

	installAddr := make(chan string, 2)
	restore := replaceTerminalDirectoryIntegrationSeams(t,
		func(*msshssh.ClientWrapper) (shellIntegration, bool, error) {
			return shellIntegrationBash, true, nil
		},
		func(wrapper *msshssh.ClientWrapper, shell shellIntegration) (string, bool, error) {
			installAddr <- wrapper.Inner.LocalAddr().String()
			return "/home/deploy/.bashrc", true, nil
		},
	)
	defer restore()

	terminalID, err := service.Open(context.Background(), created.ID, 80, 24)
	require.NoError(t, err)
	terminalConnID := service.connIDs[terminalID]
	terminalWrapper, err := sessionSvc.GetClientWrapper(terminalConnID)
	require.NoError(t, err)
	terminalAddr := terminalWrapper.Inner.LocalAddr().String()

	waitForTerminalDirectoryIntegration(t, service)

	require.NotEqual(t, terminalAddr, <-installAddr)
	require.Equal(t, 1, sessionSvc.ConnectionCount())
	require.NoError(t, service.Close(terminalID))
}

func TestTerminalServiceDirectoryIntegrationDeadlineDoesNotDisconnectTerminal(t *testing.T) {
	previousTimeout := sftpMetadataOperationTimeout
	sftpMetadataOperationTimeout = 120 * time.Millisecond
	t.Cleanup(func() { sftpMetadataOperationTimeout = previousTimeout })

	sessionSvc, service, created, cleanup := newDirectoryIntegrationTestHarness(t, true)
	defer cleanup()
	terminalBus := newMockEventBus()
	service.eventBus = terminalBus
	restore := replaceTerminalDirectoryIntegrationSeams(t,
		func(*msshssh.ClientWrapper) (shellIntegration, bool, error) {
			return shellIntegrationBash, true, nil
		},
		nil, // keep the real installer: it sets a deadline on the integration connection
	)
	defer restore()

	terminalID, err := service.Open(context.Background(), created.ID, 80, 24)
	require.NoError(t, err)
	waitForTerminalDirectoryIntegration(t, service)
	time.Sleep(300 * time.Millisecond)

	require.Equal(t, 1, service.Count())
	require.Equal(t, 1, sessionSvc.ConnectionCount())
	disconnected := false
	for _, captured := range terminalBus.Events() {
		if payload, ok := captured.Payload.(event.ConnectionStatePayload); ok &&
			captured.Name == event.ConnectionState && payload.TerminalID == terminalID && payload.State == "disconnected" {
			disconnected = true
		}
	}
	require.False(t, disconnected, "terminal must stay connected after integration deadline expires")
	require.NoError(t, service.Close(terminalID))
}

func TestTerminalServiceDirectoryIntegrationHandlesConnectionFailure(t *testing.T) {
	db := testutil.NewTestDB(t)
	require.NoError(t, store.SetSettings(db, []model.Setting{{
		Key: sftpFollowTerminalDirectorySettingKey, Namespace: "sftp",
		Value: "true", ValueType: "boolean", Version: 1,
	}}))
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	service := NewTerminalService(sessionSvc, newMockEventBus(), 2, testutil.NewTestLogger())

	started := service.startTerminalDirectoryIntegration(999)

	require.True(t, started)
	waitForTerminalDirectoryIntegration(t, service)
	require.Equal(t, 0, sessionSvc.ConnectionCount())
}

func TestTerminalServiceDirectoryIntegrationWithoutSessionService(t *testing.T) {
	service := &TerminalService{logger: testutil.NewTestLogger()}
	service.runTerminalDirectoryIntegration(1)
}

func newDirectoryIntegrationTestHarness(
	t *testing.T,
	enabled bool,
) (*SessionService, *TerminalService, *model.Session, func()) {
	t.Helper()
	db := testutil.NewTestDB(t)
	if enabled {
		require.NoError(t, store.SetSettings(db, []model.Setting{{
			Key: sftpFollowTerminalDirectorySettingKey, Namespace: "sftp",
			Value: "true", ValueType: "boolean", Version: 1,
		}}))
	}
	addr, cleanup := sshtestutil.NewMockServer(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	created, err := sessionSvc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "directory-integration", Host: "127.0.0.1", Port: parsePort(t, addr),
		Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30,
	}))
	require.NoError(t, err)
	service := NewTerminalService(sessionSvc, newMockEventBus(), 4, testutil.NewTestLogger())
	return sessionSvc, service, created, cleanup
}

func replaceTerminalDirectoryIntegrationSeams(
	t *testing.T,
	detect func(*msshssh.ClientWrapper) (shellIntegration, bool, error),
	install func(*msshssh.ClientWrapper, shellIntegration) (string, bool, error),
) func() {
	t.Helper()
	previousDetect := _detectTerminalShellIntegration
	previousInstall := _installTerminalDirectoryIntegrationForWrapper
	_detectTerminalShellIntegration = detect
	if install != nil {
		_installTerminalDirectoryIntegrationForWrapper = install
	}
	return func() {
		_detectTerminalShellIntegration = previousDetect
		_installTerminalDirectoryIntegrationForWrapper = previousInstall
	}
}

func waitForTerminalDirectoryIntegration(t *testing.T, service *TerminalService) {
	t.Helper()
	done := make(chan struct{})
	go func() {
		service.terminalDirectoryIntegrationWG.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		buf := make([]byte, 1<<20)
		n := runtime.Stack(buf, true)
		t.Fatalf("terminal directory integration did not finish\n%s", buf[:n])
	}
}
