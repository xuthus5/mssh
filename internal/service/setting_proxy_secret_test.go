package service

import (
	"bytes"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestProxyPasswordPrepareAndRedact(t *testing.T) {
	db := testutil.NewTestDB(t)
	runtime := NewCryptoRuntime()
	runtime.SetDEK(bytes.Repeat([]byte{3}, 32))
	svc := NewSettingService(db, testutil.NewTestLogger(), SettingServiceOptions{Crypto: runtime})

	// empty password write is dropped
	out, err := svc.prepareProxyPasswordWrites([]model.Setting{
		{Key: "application.theme", Namespace: "application", Value: `"dark"`, ValueType: "string", Version: 1},
		{Key: applicationProxyPasswordSetting, Namespace: "application", Value: `""`, ValueType: "string", Version: 1},
	})
	require.NoError(t, err)
	require.Len(t, out, 1)

	// encrypt write
	out, err = svc.prepareProxyPasswordWrites([]model.Setting{{
		Key: applicationProxyPasswordSetting, Namespace: "application", Value: `"hunter2"`, ValueType: "string", Version: 1,
	}})
	require.NoError(t, err)
	require.Len(t, out, 2)
	require.NoError(t, store.SetSettings(db, out))

	password, saved := svc.loadProxyPassword()
	assert.True(t, saved)
	assert.Equal(t, "hunter2", password)

	// redact helpers
	entry := model.Setting{Key: applicationProxyPasswordSetting, Value: `"secret"`}
	redactProxyPasswordSetting(&entry)
	assert.Equal(t, `""`, entry.Value)
	redactProxyPasswordSetting(nil)
	settings := map[string]model.Setting{applicationProxyPasswordSetting: entry}
	redactProxyPasswordSettings(settings)
	assert.Equal(t, `""`, settings[applicationProxyPasswordSetting].Value)
	assert.Contains(t, settings, applicationProxyPasswordSavedSetting)
	redactProxyPasswordSettings(nil)

	// clear sentinel
	out, err = svc.prepareProxyPasswordWrites([]model.Setting{{
		Key: applicationProxyPasswordSetting, Namespace: "application",
		Value: `"` + proxyPasswordClearSentinel + `"`, ValueType: "string", Version: 1,
	}})
	require.NoError(t, err)
	require.Len(t, out, 1)
	require.NoError(t, store.SetSettings(db, out))
	password, saved = svc.loadProxyPassword()
	assert.False(t, saved)
	assert.Equal(t, "", password)
}
