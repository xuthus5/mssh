package service

import (
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	msshssh "github.com/xuthus5/mssh/internal/ssh"
	"github.com/xuthus5/mssh/internal/store"
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

	started := service.startTerminalDirectoryIntegration(1, &msshssh.ClientWrapper{})

	require.False(t, started)
}

func TestTerminalServiceStartDirectoryIntegrationInstallsDetectedShell(t *testing.T) {
	db := testutil.NewTestDB(t)
	require.NoError(t, store.SetSettings(db, []model.Setting{{
		Key: "sftp.follow_terminal_directory", Namespace: "sftp",
		Value: "true", ValueType: "boolean", Version: 1,
	}}))
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	service := NewTerminalService(sessionSvc, newMockEventBus(), 2, testutil.NewTestLogger())
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

	started := service.startTerminalDirectoryIntegration(1, &msshssh.ClientWrapper{})

	require.True(t, started)
	waitForTerminalDirectoryIntegration(t, service)
	require.Equal(t, shellIntegrationZsh, <-installed)
}

func TestTerminalServiceDirectoryIntegrationErrorDoesNotBlockOpen(t *testing.T) {
	db := testutil.NewTestDB(t)
	require.NoError(t, store.SetSettings(db, []model.Setting{{
		Key: "sftp.follow_terminal_directory", Namespace: "sftp",
		Value: "true", ValueType: "boolean", Version: 1,
	}}))
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	service := NewTerminalService(sessionSvc, newMockEventBus(), 2, testutil.NewTestLogger())
	restore := replaceTerminalDirectoryIntegrationSeams(t,
		func(*msshssh.ClientWrapper) (shellIntegration, bool, error) {
			return shellIntegrationBash, true, nil
		},
		func(*msshssh.ClientWrapper, shellIntegration) (string, bool, error) {
			return "", false, errors.New("permission denied")
		},
	)
	defer restore()

	started := service.startTerminalDirectoryIntegration(1, &msshssh.ClientWrapper{})

	require.True(t, started)
	waitForTerminalDirectoryIntegration(t, service)
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

	service.runTerminalDirectoryIntegration(1, &msshssh.ClientWrapper{})
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

	service.runTerminalDirectoryIntegration(1, &msshssh.ClientWrapper{})
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
	_installTerminalDirectoryIntegrationForWrapper = install
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
	case <-time.After(time.Second):
		t.Fatal("terminal directory integration did not finish")
	}
}
