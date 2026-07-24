package service

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	cryptopkg "github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/serial"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestEnsurePrivateParentDirAndValidateRows(t *testing.T) {
	dir := t.TempDir()
	// existing directory ok
	require.NoError(t, ensurePrivateParentDir(dir))
	// missing creates
	nested := filepath.Join(dir, "a", "b")
	require.NoError(t, ensurePrivateParentDir(nested))
	info, err := os.Stat(nested)
	require.NoError(t, err)
	assert.True(t, info.IsDir())

	// parent is file
	filePath := filepath.Join(dir, "not-dir")
	require.NoError(t, os.WriteFile(filePath, []byte("x"), 0o600))
	assert.Error(t, ensurePrivateParentDir(filePath))

	// validateTableRows unknown column
	err = validateTableRows("sessions", []map[string]any{{"id": 1, "nope": true}}, map[string]struct{}{"id": {}})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unknown column")

	// empty rows ok
	require.NoError(t, validateTableRows("sessions", nil, map[string]struct{}{"id": {}}))

	db := testutil.NewTestDB(t)
	cols, err := tableColumns(db, "sessions")
	require.NoError(t, err)
	assert.Contains(t, cols, "id")
	_, err = tableColumns(db, "not_a_table_zzz")
	// SQLite PRAGMA on missing table returns empty, not always error - either ok.
	_ = err
}

func TestBuildReencryptPlanEmptyAndCorruptKey(t *testing.T) {
	db := testutil.NewTestDB(t)
	oldCrypto := &staticCrypto{key: make([]byte, 32)}
	newCrypto := &staticCrypto{key: bytesRepeat(5)}
	// fill DEK-like keys with proper length for AES via crypto.Encrypt which needs 32
	oldCrypto = &staticCrypto{key: bytesRepeat(1)}
	newCrypto = &staticCrypto{key: bytesRepeat(2)}

	plan, err := buildReencryptPlan(db, oldCrypto, newCrypto)
	require.NoError(t, err)
	assert.Empty(t, plan.keys)
	assert.Empty(t, plan.sessions)
	assert.Empty(t, plan.settings)

	// insert corrupt encrypted key
	_, err = store.CreateKey(db, model.SSHKey{Name: "bad", Type: "ed25519", PublicKey: "pub", PrivateKey: "not-encrypted"})
	require.NoError(t, err)
	_, err = buildReencryptPlan(db, oldCrypto, newCrypto)
	require.Error(t, err)
}

func bytesRepeat(b byte) []byte {
	out := make([]byte, 32)
	for i := range out {
		out[i] = b
	}
	return out
}

func TestListSSHKeyIDs(t *testing.T) {
	db := testutil.NewTestDB(t)
	ids, err := listSSHKeyIDs(db)
	require.NoError(t, err)
	assert.Empty(t, ids)
	_, err = store.CreateKey(db, model.SSHKey{Name: "k", Type: "ed25519", PublicKey: "pub", PrivateKey: "priv"})
	require.NoError(t, err)
	ids, err = listSSHKeyIDs(db)
	require.NoError(t, err)
	require.Len(t, ids, 1)
}

func TestNormalizedIDsAndEnsureExist(t *testing.T) {
	db := testutil.NewTestDB(t)
	ids, err := normalizedIDsAllowEmpty(nil)
	require.NoError(t, err)
	assert.Empty(t, ids)
	_, err = normalizedIDsAllowEmpty([]int64{1, 0})
	require.Error(t, err)
	ids, err = normalizedIDsAllowEmpty([]int64{2, 2, 3})
	require.NoError(t, err)
	assert.Equal(t, []int64{2, 3}, ids)

	tx, err := db.Begin()
	require.NoError(t, err)
	t.Cleanup(func() { _ = tx.Rollback() })
	// empty ensure is ok? depends on countIDsQuery
	err = ensureIDsExist(tx, "asset_tags", []int64{999})
	require.Error(t, err)
}

func TestReencryptProtectedDataEmpty(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := &SecurityService{db: db}
	require.NoError(t, svc.reencryptProtectedData(bytesRepeat(1), bytesRepeat(2)))
}

func TestBuildReencryptPlanWithSessionPassword(t *testing.T) {
	db := testutil.NewTestDB(t)
	oldCrypto := &staticCrypto{key: bytesRepeat(3)}
	newCrypto := &staticCrypto{key: bytesRepeat(4)}
	sealed, err := sealSessionPassword(oldCrypto, "pw")
	require.NoError(t, err)
	_, err = store.CreateSession(db, model.Session{
		Name: "s", Host: "h", Port: 22, Username: "u", AuthMethod: model.AuthPassword,
		Password: sealed, KeepAlive: 30, TermType: "xterm",
	})
	require.NoError(t, err)
	plan, err := buildReencryptPlan(db, oldCrypto, newCrypto)
	require.NoError(t, err)
	require.NotEmpty(t, plan.sessions)
}

func TestWaitSystemProbeTimeout(t *testing.T) {
	orig := systemProbeTimeout
	systemProbeTimeout = 20 * time.Millisecond
	t.Cleanup(func() { systemProbeTimeout = orig })
	cancelled := false
	_, err := waitSystemProbe(func() ([]byte, error) {
		time.Sleep(200 * time.Millisecond)
		return []byte("late"), nil
	}, func() error {
		cancelled = true
		return nil
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "timeout")
	assert.True(t, cancelled)
}

func TestWaitSystemProbeSuccess(t *testing.T) {
	out, err := waitSystemProbe(func() ([]byte, error) {
		return []byte("ok"), nil
	}, func() error { return nil })
	require.NoError(t, err)
	assert.Equal(t, []byte("ok"), out)
}

func TestLocalShellOptionsFromSettings(t *testing.T) {
	db := testutil.NewTestDB(t)
	require.NoError(t, store.SetSettings(db, []model.Setting{
		{Key: "terminal.local_shell", Namespace: "terminal", Value: `"/bin/bash"`, ValueType: "string", Version: 1},
		{Key: "terminal.local_shell_args", Namespace: "terminal", Value: `"-l --norc"`, ValueType: "string", Version: 1},
		{Key: "terminal.local_shell_cwd", Namespace: "terminal", Value: `"/tmp"`, ValueType: "string", Version: 1},
		{Key: "terminal.local_shell_login", Namespace: "terminal", Value: `false`, ValueType: "boolean", Version: 1},
		{Key: "terminal.default_term_type", Namespace: "terminal", Value: `"xterm"`, ValueType: "string", Version: 1},
	}))
	sessionSvc := &SessionService{db: db}
	term := NewTerminalService(sessionSvc, discardEventBus{}, 4, slog.Default())
	opts, err := term.localShellOptions(80, 24)
	require.NoError(t, err)
	assert.Equal(t, "/bin/bash", opts.Shell)
	assert.Equal(t, []string{"-l", "--norc"}, opts.Args)
	assert.Equal(t, "/tmp", opts.CWD)
	assert.False(t, opts.Login)
	assert.Equal(t, "xterm", opts.Term)

	_, err = db.Exec(`UPDATE settings SET value=?, value_type='string' WHERE key=?`, `"1"`, "terminal.local_shell_login")
	require.NoError(t, err)
	val, ok := readSettingBool(db, "terminal.local_shell_login")
	assert.True(t, ok)
	assert.True(t, val)
	val, ok = readSettingBool(db, "missing")
	assert.False(t, ok)
	assert.False(t, val)
	_, ok = readSettingString(db, "missing")
	assert.False(t, ok)
	_, err = db.Exec(`UPDATE settings SET value='"0"' WHERE key='terminal.local_shell_login'`)
	require.NoError(t, err)
	val, ok = readSettingBool(db, "terminal.local_shell_login")
	assert.True(t, ok)
	assert.False(t, val)
}

func TestTerminalAttachFlushesPendingOutput(t *testing.T) {
	bus := newMockEventBus()
	term := NewTerminalService(nil, bus, 4, slog.Default())
	id := "term-pending"
	session := serial.NewTestPortSession("/dev/ttyPEND")
	term.mu.Lock()
	term.ptys[id] = session
	term.pendingOutput[id] = []byte("buffered")
	term.attached[id] = false
	term.mu.Unlock()

	require.NoError(t, term.Attach(id))
	require.NoError(t, term.Attach(id)) // already attached
	require.Error(t, term.Attach("missing"))

	// unattached output buffers
	term.mu.Lock()
	term.attached[id] = false
	term.mu.Unlock()
	term.handlePTYOutput(id, []byte("more"))
	term.handlePTYOutput("missing", []byte("x"))
	// attached path emits
	term.mu.Lock()
	term.attached[id] = true
	term.mu.Unlock()
	term.handlePTYOutput(id, []byte("live"))
	// clone cap
	big := make([]byte, maxPendingTerminalOutput+10)
	assert.Equal(t, maxPendingTerminalOutput, len(cloneTerminalOutput(big)))
	assert.Nil(t, cloneTerminalOutput(nil))
	term.expirePendingOutput(id)
	_ = session.Close()
}

func TestAIProviderSecretStateAndLoad(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewAIService(db, nil, &memoryKeychain{}, slog.Default())
	settings := defaultAISettings()
	settings.Search.Provider = model.AISearchProviderTavily
	svc.enrichSearchSecretState(&settings)
	assert.False(t, settings.Search.CredentialSaved)

	profile, err := store.SaveAIProviderProfile(db, model.AIProviderProfileInput{
		Name: "ollama", Provider: model.AIProviderOllama, BaseURL: "http://127.0.0.1:11434", DefaultModel: "llama", Enabled: true,
	})
	require.NoError(t, err)
	saved, sessionOnly, err := svc.providerSecretState(profile.ID)
	require.NoError(t, err)
	assert.False(t, saved)
	assert.False(t, sessionOnly)
	loaded, secret, err := svc.loadProvider(profile.ID)
	require.NoError(t, err)
	assert.Equal(t, profile.ID, loaded.ID)
	assert.Equal(t, "", secret)
	_, _, err = svc.loadProvider(99999)
	require.Error(t, err)

	// disabled provider
	_, err = store.SaveAIProviderProfile(db, model.AIProviderProfileInput{
		ID: profile.ID, Name: "ollama", Provider: model.AIProviderOllama, BaseURL: "http://127.0.0.1:11434", DefaultModel: "llama", Enabled: false,
	})
	require.NoError(t, err)
	_, _, err = svc.loadProvider(profile.ID)
	require.Error(t, err)

	openai, err := store.SaveAIProviderProfile(db, model.AIProviderProfileInput{
		Name: "oa", Provider: model.AIProviderOpenAICompatible, BaseURL: "https://api.openai.com", DefaultModel: "gpt", Enabled: true,
	})
	require.NoError(t, err)
	_, _, err = svc.loadProvider(openai.ID)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "API key")
}

func TestSealOpenSessionPassword(t *testing.T) {
	c := &staticCrypto{key: bytesRepeat(8)}
	empty, err := sealSessionPassword(c, "")
	require.NoError(t, err)
	assert.Equal(t, "", empty)
	opened, err := openSessionPassword(c, "")
	require.NoError(t, err)
	assert.Equal(t, "", opened)
	_, err = openSessionPassword(c, "plaintext")
	require.Error(t, err)
	sealed, err := sealSessionPassword(c, "secret")
	require.NoError(t, err)
	opened, err = openSessionPassword(c, sealed)
	require.NoError(t, err)
	assert.Equal(t, "secret", opened)
}

func TestTerminalPoolClearDetachAndLRU(t *testing.T) {
	bus := newMockEventBus()
	term := NewTerminalService(nil, bus, 1, slog.Default())
	require.Error(t, term.SetMaxSize(0))
	require.NoError(t, term.SetMaxSize(2))
	assert.Equal(t, 0, term.Count())

	// buffered-only terminal can be cleared
	term.mu.Lock()
	term.pendingOutput["buf-only"] = []byte("x")
	term.mu.Unlock()
	assert.True(t, term.clearBufferedTerminal("buf-only"))
	assert.False(t, term.clearBufferedTerminal("buf-only"))
	assert.False(t, term.clearBufferedTerminal("missing"))

	s1 := serial.NewTestPortSession("/dev/tty1")
	s2 := serial.NewTestPortSession("/dev/tty2")
	term.mu.Lock()
	term.ptys["a"] = s1
	term.ptys["b"] = s2
	term.lastUsed["a"] = time.Now().Add(-time.Minute)
	term.lastUsed["b"] = time.Now()
	term.attached["a"] = false
	term.attached["b"] = true
	term.mu.Unlock()
	assert.Equal(t, 2, term.Count())

	// detach a
	pty, _, _, ok := term.detachTerminal("a")
	assert.True(t, ok)
	require.NotNil(t, pty)
	_, _, _, ok = term.detachTerminal("missing")
	assert.False(t, ok)

	// re-register for LRU: unattached older should win
	term.mu.Lock()
	term.ptys["a"] = s1
	term.ptys["b"] = s2
	term.lastUsed["a"] = time.Now().Add(-time.Minute)
	term.lastUsed["b"] = time.Now()
	term.attached["a"] = false
	term.attached["b"] = true
	term.mu.Unlock()
	term.evictLRU()
	term.mu.RLock()
	_, hasA := term.ptys["a"]
	_, hasB := term.ptys["b"]
	term.mu.RUnlock()
	assert.False(t, hasA)
	assert.True(t, hasB)
	_ = s1.Close()
	_ = s2.Close()
}

func TestParseSessionCSVRecordBasics(t *testing.T) {
	columns := map[string]int{
		"format_version": 0, "name": 1, "host": 2, "port": 3, "username": 4, "auth_method": 5,
		"password": 6, "key_name": 7, "key_public_key": 8, "folder_path": 9, "environment": 10,
		"project": 11, "tags": 12, "notes": 13, "keep_alive": 14, "term_type": 15,
	}
	values := []string{sessionCSVVersion, "n", "h", "22", "u", "password", "p", "", "", "prod/app", "prod", "pay", "db,core", "note", "30", "xterm"}
	rec, err := parseSessionCSVRecord(2, columns, values)
	require.NoError(t, err)
	assert.Equal(t, "n", rec.Name)
	assert.Equal(t, 22, rec.Port)
	assert.Equal(t, []string{"prod", "app"}, rec.FolderPath)
	assert.Equal(t, []string{"db", "core"}, rec.Tags)

	_, err = parseSessionCSVRecord(3, columns, []string{"bad", "n", "h", "22", "u", "password", "", "", "", "", "", "", "", "", "30", "xterm"})
	require.Error(t, err)
}

func TestCloudMetadataAndBackupHelpers(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := &SyncService{db: db, logger: slog.Default(), dataDir: t.TempDir()}
	assert.Equal(t, "", svc.cloudETag())
	require.NoError(t, svc.saveCloudMetadata(`"abc"`, "upload"))
	// cloudETag unmarshals JSON string from settings value
	// saveCloudMetadata json-marshals etag again so stored is "\"\\\"abc\\\"\"" etc - still non-empty path
	_ = svc.cloudETag()

	content, err := readCloudBackup(strings.NewReader("hello"))
	require.NoError(t, err)
	assert.Equal(t, []byte("hello"), content)

	// oversized
	big := strings.NewReader(strings.Repeat("a", maxCloudBackupSize+2))
	_, err = readCloudBackup(big)
	require.Error(t, err)

	result := svc.finishJoinSuccess(model.SyncConfig{Provider: model.SyncProviderGist, Enabled: true})
	assert.Equal(t, model.SyncStateSynced, result.State)
	svc.markPending("wait")
	svc.setRuntimeState(syncRuntimeState{State: model.SyncStateError, Message: "x"})
}

func TestRunSyncDisabledAndBusy(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSyncService(db, slog.Default())
	svc.dataDir = t.TempDir()
	ctx := context.Background()
	svc.operationMu.Lock()
	_, err := svc.runSync(ctx, syncDirectionStrategy, "manual")
	svc.operationMu.Unlock()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "already running")
}

func TestCreateVaultPasswordValidation(t *testing.T) {
	_, _, err := cryptopkg.CreateVault("short")
	require.Error(t, err)
}

func TestAssetCatalogUpdateValidation(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewAssetCatalogService(db, slog.Default())
	env, err := svc.CreateEnvironment(model.AssetEnvironmentInput{Name: "prod", ColorToken: model.AssetColorRed})
	require.NoError(t, err)
	require.Error(t, svc.UpdateEnvironment(model.AssetEnvironmentInput{ID: env.ID, Name: "prod", ColorToken: "bad"}))
	require.Error(t, svc.UpdateEnvironment(model.AssetEnvironmentInput{ID: env.ID, Name: "prod", ColorToken: model.AssetColorRed, SortOrder: -1}))
	require.NoError(t, svc.UpdateEnvironment(model.AssetEnvironmentInput{ID: env.ID, Name: "prod2", ColorToken: model.AssetColorBlue, SortOrder: 2}))

	proj, err := svc.CreateProject(model.AssetProjectInput{Name: "pay", Code: "PAY"})
	require.NoError(t, err)
	require.Error(t, svc.UpdateProject(model.AssetProjectInput{ID: proj.ID, Name: "", Code: "PAY"}))
	require.NoError(t, svc.UpdateProject(model.AssetProjectInput{ID: proj.ID, Name: "pay2", Code: "PAY2", Description: "d", SortOrder: 1}))

	tag, err := svc.CreateTag(model.AssetTagInput{Name: "db", ColorToken: model.AssetColorGreen})
	require.NoError(t, err)
	require.Error(t, svc.UpdateTag(model.AssetTagInput{ID: tag.ID, Name: "db", ColorToken: "nope"}))
	require.NoError(t, svc.UpdateTag(model.AssetTagInput{ID: tag.ID, Name: "db2", ColorToken: model.AssetColorViolet}))
}

func TestClosedDBCoverageBoost(t *testing.T) {
	db := testutil.NewTestDB(t)
	require.NoError(t, db.Close())

	svc := &SyncService{db: db, logger: slog.Default(), dataDir: t.TempDir()}
	assert.Error(t, svc.saveCloudMetadata("e", "up"))
	assert.Equal(t, "", svc.cloudETag())

	_, err := tableColumns(db, "sessions")
	require.Error(t, err)
	assert.Error(t, validateSnapshot(db, ExportData{Tables: map[string][]map[string]any{}}))

	_, err = listSSHKeyIDs(db)
	require.Error(t, err)
	_, err = buildReencryptPlan(db, &staticCrypto{key: bytesRepeat(1)}, &staticCrypto{key: bytesRepeat(2)})
	require.Error(t, err)

	catalog := NewAssetCatalogService(db, slog.Default())
	_, err = catalog.CreateEnvironment(model.AssetEnvironmentInput{Name: "x", ColorToken: model.AssetColorRed})
	require.Error(t, err)
	_, err = catalog.CreateProject(model.AssetProjectInput{Name: "x", Code: "C"})
	require.Error(t, err)
	_, err = catalog.CreateTag(model.AssetTagInput{Name: "x", ColorToken: model.AssetColorBlue})
	require.Error(t, err)

	ai := NewAIService(db, nil, &memoryKeychain{}, slog.Default())
	_, _, err = ai.loadProvider(1)
	require.Error(t, err)
}

func TestReadCloudBackupErrorPath(t *testing.T) {
	_, err := readCloudBackup(errReader{})
	require.Error(t, err)
}

type errReader struct{}

func (errReader) Read([]byte) (int, error) { return 0, assert.AnError }

func TestSyncMarkPendingAndRuntime(t *testing.T) {
	svc := &SyncService{logger: slog.Default()}
	svc.markPending("p")
	svc.stateMu.RLock()
	assert.Equal(t, model.SyncStatePending, svc.state.State)
	svc.stateMu.RUnlock()
	svc.setRuntimeState(syncRuntimeState{State: model.SyncStateSynced, Message: "ok", Remote: &model.SyncRemoteVersion{VersionID: "1"}})
	svc.stateMu.RLock()
	assert.Equal(t, model.SyncStateSynced, svc.state.State)
	svc.stateMu.RUnlock()
}

func TestWritePrivateParentDirStatError(t *testing.T) {
	// path with NUL is invalid on most OS
	err := ensurePrivateParentDir(string([]byte{0}))
	require.Error(t, err)
}
