package service

import (
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestValidateTunnelBindRejectsNonLoopback(t *testing.T) {
	err := validateTunnelBind(model.Tunnel{Type: model.TunnelLocal, LocalHost: "0.0.0.0"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "loopback")

	err = validateTunnelBind(model.Tunnel{Type: model.TunnelDynamic, LocalHost: "192.168.1.10"})
	require.Error(t, err)

	err = validateTunnelBind(model.Tunnel{Type: model.TunnelLocal, LocalHost: "127.0.0.1"})
	require.NoError(t, err)

	err = validateTunnelBind(model.Tunnel{Type: model.TunnelRemote, LocalHost: "0.0.0.0"})
	require.NoError(t, err)
}

func TestTunnelService_CreateRejectsNonLoopback(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	svc := NewTunnelService(db, sessionSvc, newMockEventBus(), testutil.NewTestLogger())
	sess, err := sessionSvc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "t", Host: "10.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm",
	}))
	require.NoError(t, err)

	_, err = svc.Create(model.TunnelInputFrom(model.Tunnel{
		SessionID: sess.ID, Name: "bad", Type: model.TunnelLocal,
		LocalHost: "0.0.0.0", LocalPort: 8080, RemoteHost: "r", RemotePort: 80,
	}))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "loopback")
}

func TestRequireHTTPSUnlessLoopback(t *testing.T) {
	httpsURL, err := url.Parse("https://gist.github.com")
	require.NoError(t, err)
	require.NoError(t, requireHTTPSUnlessLoopback(httpsURL))

	loop, err := url.Parse("http://127.0.0.1:8080/dav")
	require.NoError(t, err)
	require.NoError(t, requireHTTPSUnlessLoopback(loop))

	insecure, err := url.Parse("http://example.com/dav")
	require.NoError(t, err)
	require.Error(t, requireHTTPSUnlessLoopback(insecure))
}

func TestValidateUserRegexp(t *testing.T) {
	require.NoError(t, validateUserRegexp(`^ls\b`))
	require.Error(t, validateUserRegexp(""))
	require.Error(t, validateUserRegexp(strings.Repeat("a", maxUserRegexpLength+1)))
	require.Error(t, validateUserRegexp(strings.Repeat("(", maxUserRegexpDepth+1)+"a"+strings.Repeat(")", maxUserRegexpDepth+1)))
	require.Error(t, validateUserRegexp("(.*)*"))
	require.Error(t, validateUserRegexp("[unclosed"))
}

func TestMacroService_ExecuteBlocksDangerousCommand(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewMacroService(db, nil, testutil.NewTestLogger())
	err := svc.Execute("term-1", "rm -rf /")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "macro blocked")
}

func TestFileService_shouldPersistTransferProgressThrottle(t *testing.T) {
	svc := &FileService{
		startsAt:            make(map[string]time.Time),
		lastProgressPersist: make(map[string]time.Time),
		lastProgressBytes:   make(map[string]int64),
		logger:              testutil.NewTestLogger(),
	}
	assert.True(t, svc.shouldPersistTransferProgress("t1", 10, 1000))
	assert.False(t, svc.shouldPersistTransferProgress("t1", 20, 1000))
	svc.lastProgressPersist["t1"] = time.Now().Add(-time.Second)
	assert.True(t, svc.shouldPersistTransferProgress("t1", 30, 1000))
	// completion always persists
	assert.True(t, svc.shouldPersistTransferProgress("t1", 1000, 1000))
}

func TestSessionCSVExportDecryptsSealedPassword(t *testing.T) {
	db := testutil.NewTestDB(t)
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i + 1)
	}
	crypto := &staticCrypto{key: key}
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), crypto, testutil.NewTestLogger())
	created, err := svc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "sec", Host: "10.0.0.2", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "export-secret", KeepAlive: 30, TermType: "xterm",
	}))
	require.NoError(t, err)
	assert.Empty(t, created.Password)

	raw, err := store.GetSession(db, created.ID)
	require.NoError(t, err)
	require.True(t, strings.HasPrefix(raw.Password, sessionPasswordPrefix))

	path := t.TempDir() + "/export.csv"
	result, err := svc.ExportCSV(path, model.SessionCSVExportOptions{IncludePasswords: true, SessionIDs: []int64{created.ID}})
	require.NoError(t, err)
	assert.True(t, result.IncludedPasswords)
	content, err := readFileString(path)
	require.NoError(t, err)
	assert.Contains(t, content, "export-secret")
	assert.NotContains(t, content, sessionPasswordPrefix)
}

func readFileString(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func TestCryptoRuntimeClearZeroizesDEK(t *testing.T) {
	runtime := NewCryptoRuntime()
	key := make([]byte, 32)
	for i := range key {
		key[i] = 0xAB
	}
	runtime.SetDEK(key)
	require.True(t, runtime.Unlocked())
	runtime.Clear()
	assert.False(t, runtime.Unlocked())
	_, err := runtime.Encrypt([]byte("x"))
	require.ErrorIs(t, err, ErrVaultLocked)
}

func TestBuildAuthBundleAgentMissingSocket(t *testing.T) {
	t.Setenv("SSH_AUTH_SOCK", "")
	svc := NewSessionService(testutil.NewTestDB(t), newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	_, cleanup, err := svc.buildAuthBundle(&model.Session{AuthMethod: model.AuthAgent})
	require.Error(t, err)
	assert.Nil(t, cleanup)
}

func TestPickLRUVictimPrefersUnattached(t *testing.T) {
	svc := NewTerminalService(&SessionService{conns: map[string]*managedConn{}}, newMockEventBus(), 2, testutil.NewTestLogger())
	svc.lastUsed = map[string]time.Time{
		"attached-old": time.Now().Add(-time.Hour),
		"orphan-new":   time.Now().Add(-time.Minute),
	}
	svc.attached = map[string]bool{"attached-old": true}
	assert.Equal(t, "orphan-new", svc.pickLRUVictim())
}

func TestCloneTerminalOutputCapsAndCopies(t *testing.T) {
	src := []byte("hello")
	cloned := cloneTerminalOutput(src)
	assert.Equal(t, src, cloned)
	src[0] = 'H'
	assert.Equal(t, byte('h'), cloned[0])

	huge := make([]byte, maxPendingTerminalOutput+128)
	capped := cloneTerminalOutput(huge)
	assert.Equal(t, maxPendingTerminalOutput, len(capped))
	assert.Nil(t, cloneTerminalOutput(nil))
}
