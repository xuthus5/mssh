package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestApplyReencryptPlanRollsBackOnFailure(t *testing.T) {
	db := testutil.NewTestDB(t)
	key, err := store.CreateKey(db, model.SSHKey{
		Name: "k", Type: model.KeyTypeED25519, PrivateKey: "old-private", PublicKey: "ssh-ed25519 AAAA",
	})
	require.NoError(t, err)

	// Non-existent session id forces failure after key update in same txn.
	err = applyReencryptPlan(db, reencryptPlan{
		keys:     []reencryptKeyUpdate{{id: key.ID, privateKey: "new-private"}},
		sessions: []reencryptSessionUpdate{{id: 999999, password: "x"}},
	})
	require.Error(t, err)

	stored, err := store.GetKey(db, key.ID)
	require.NoError(t, err)
	assert.Equal(t, "old-private", stored.PrivateKey)
}

func TestApplyReencryptPlanCommitsAll(t *testing.T) {
	db := testutil.NewTestDB(t)
	key, err := store.CreateKey(db, model.SSHKey{
		Name: "k", Type: model.KeyTypeED25519, PrivateKey: "old-private", PublicKey: "ssh-ed25519 AAAA",
	})
	require.NoError(t, err)
	session, err := store.CreateSession(db, model.Session{
		Name: "s", Host: "h", Port: 22, Username: "u", AuthMethod: model.AuthPassword,
		Password: "old-pass", KeepAlive: 30, TermType: "xterm",
	})
	require.NoError(t, err)

	require.NoError(t, applyReencryptPlan(db, reencryptPlan{
		keys:     []reencryptKeyUpdate{{id: key.ID, privateKey: "new-private"}},
		sessions: []reencryptSessionUpdate{{id: session.ID, password: "new-pass"}},
		settings: []model.Setting{{
			Key: applicationProxyPasswordSetting, Namespace: "application",
			Value: `"enc1:proxy"`, ValueType: "string", Version: 1,
		}},
	}))

	storedKey, err := store.GetKey(db, key.ID)
	require.NoError(t, err)
	assert.Equal(t, "new-private", storedKey.PrivateKey)
	storedSession, err := store.GetSession(db, session.ID)
	require.NoError(t, err)
	assert.Equal(t, "new-pass", storedSession.Password)
	entry, err := store.GetSettingEntry(db, applicationProxyPasswordSetting)
	require.NoError(t, err)
	require.NotNil(t, entry)
	assert.Equal(t, `"enc1:proxy"`, entry.Value)
}
