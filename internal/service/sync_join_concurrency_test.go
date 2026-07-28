package service

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	backupcrypto "github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestJoinWithPasswordSerializesConcurrentConfigSave(t *testing.T) {
	sourceDB := testutil.NewTestDB(t)
	content, _, secret := passwordArtifactForTest(t, sourceDB, "join-config-lock-pass-12", nil)
	provider := &fakeSyncProvider{remote: syncRemoteObject{Content: content}}
	restoreStarted := make(chan struct{})
	allowRestore := make(chan struct{})
	service := newTestSyncService(
		testutil.NewTestDB(t),
		secret,
		WithSyncDataDir(t.TempDir()),
		WithSyncProviderFactory(fakeSyncProviderFactory{provider}),
		WithVaultTransactionInstaller(func(string, backupcrypto.VaultFile) (VaultInstallTransaction, error) {
			return &stubVaultInstallTransaction{operation: func(operation func() error) error {
				close(restoreStarted)
				<-allowRestore
				return operation()
			}}, nil
		}),
	)
	joinDone := make(chan error, 1)
	go func() {
		_, err := service.JoinWithPassword(syncVaultJoinInput(), "join-config-lock-pass-12")
		joinDone <- err
	}()
	<-restoreStarted
	savedInput := syncVaultJoinInput()
	savedInput.Provider = model.SyncProviderGist
	savedInput.Gist.GistID = "user-selected-gist"
	savedInput.WebDAV = model.WebDAVSyncConfigInput{}
	saveDone := make(chan error, 1)
	saveStarted := make(chan struct{})
	go func() {
		close(saveStarted)
		_, err := service.SaveConfig(savedInput)
		saveDone <- err
	}()
	<-saveStarted
	var saveErr error
	completedEarly := false
	select {
	case saveErr = <-saveDone:
		completedEarly = true
	case <-time.After(100 * time.Millisecond):
	}
	close(allowRestore)
	require.NoError(t, <-joinDone)
	if !completedEarly {
		saveErr = <-saveDone
	}
	require.NoError(t, saveErr)
	assert.False(t, completedEarly, "configuration save completed before join released its transaction")
	config, err := service.LoadConfig()
	require.NoError(t, err)
	assert.Equal(t, model.SyncProviderGist, config.Provider)
	assert.Equal(t, "user-selected-gist", config.Gist.GistID)
}
