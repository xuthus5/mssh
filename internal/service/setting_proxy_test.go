package service

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/netproxy"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

type stubProxyConfigurer struct {
	config netproxy.Config
	calls  int
	err    error
}

func (s *stubProxyConfigurer) Configure(config netproxy.Config) error {
	s.calls++
	if s.err != nil {
		return s.err
	}
	s.config = config
	return nil
}

func (s *stubProxyConfigurer) Config() netproxy.Config { return s.config }

func testProxyCrypto(t *testing.T) *CryptoRuntime {
	t.Helper()
	runtime := NewCryptoRuntime()
	runtime.SetDEK(make([]byte, 32))
	return runtime
}

func TestSettingProxySettingsApply(t *testing.T) {
	db := testutil.NewTestDB(t)
	proxy := &stubProxyConfigurer{config: netproxy.DefaultConfig()}
	svc := NewSettingService(db, testutil.NewTestLogger(), SettingServiceOptions{Proxy: proxy, Crypto: testProxyCrypto(t)})

	require.NoError(t, svc.SetMany([]model.SettingInput{
		model.SettingInputFrom(model.Setting{Key: applicationProxyModeSetting, Namespace: "application", Value: `"manual"`, ValueType: "string", Version: 1}),
		model.SettingInputFrom(model.Setting{Key: applicationProxyURLSetting, Namespace: "application", Value: `"http://127.0.0.1:1080"`, ValueType: "string", Version: 1}),
		model.SettingInputFrom(model.Setting{Key: applicationProxyNoProxySetting, Namespace: "application", Value: `"localhost,127.0.0.1"`, ValueType: "string", Version: 1}),
		model.SettingInputFrom(model.Setting{Key: applicationProxyUsernameSetting, Namespace: "application", Value: `"user"`, ValueType: "string", Version: 1}),
		model.SettingInputFrom(model.Setting{Key: applicationProxyPasswordSetting, Namespace: "application", Value: `"pass"`, ValueType: "string", Version: 1}),
	}))
	assert.Equal(t, 1, proxy.calls)
	assert.Equal(t, netproxy.ModeManual, proxy.config.Mode)
	assert.Equal(t, "http://127.0.0.1:1080", proxy.config.URL)
	assert.Equal(t, "user", proxy.config.Username)
	assert.Equal(t, "pass", proxy.config.Password)

	before := proxy.calls
	err := svc.Set(model.SettingInputFrom(model.Setting{Key: applicationProxyURLSetting, Namespace: "application", Value: `"ftp://bad"`, ValueType: "string", Version: 1}))
	assert.Error(t, err)
	assert.Equal(t, before, proxy.calls)

	require.NoError(t, svc.ApplyStoredProxySettings())
	assert.GreaterOrEqual(t, proxy.calls, 2)
}

func TestSettingProxyPartialUpdateKeepsOtherFields(t *testing.T) {
	db := testutil.NewTestDB(t)
	proxy := &stubProxyConfigurer{config: netproxy.Config{Mode: netproxy.ModeManual, URL: "http://old:1", NoProxy: "a.com"}}
	for key, value := range map[string]string{
		applicationProxyModeSetting:    "manual",
		applicationProxyURLSetting:     "http://old:1",
		applicationProxyNoProxySetting: "a.com",
	} {
		payload, err := json.Marshal(value)
		require.NoError(t, err)
		require.NoError(t, store.SetSettings(db, []model.Setting{{
			Key: key, Namespace: "application", Value: string(payload), ValueType: "string", Version: 1,
		}}))
	}
	svc := NewSettingService(db, testutil.NewTestLogger(), SettingServiceOptions{Proxy: proxy, Crypto: testProxyCrypto(t)})
	require.NoError(t, svc.Set(model.SettingInputFrom(model.Setting{
		Key: applicationProxyURLSetting, Namespace: "application", Value: `"http://new:8080"`, ValueType: "string", Version: 1,
	})))
	assert.Equal(t, "http://new:8080", proxy.config.URL)
	assert.Equal(t, netproxy.ModeManual, proxy.config.Mode)
	assert.Equal(t, "a.com", proxy.config.NoProxy)
}

func TestApplyStoredProxySettingsWithoutConfigurer(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSettingService(db, testutil.NewTestLogger())
	require.NoError(t, svc.ApplyStoredProxySettings())
}

func TestSettingProxyPasswordEncryptedAndRedacted(t *testing.T) {
	db := testutil.NewTestDB(t)
	proxy := &stubProxyConfigurer{config: netproxy.DefaultConfig()}
	svc := NewSettingService(db, testutil.NewTestLogger(), SettingServiceOptions{Proxy: proxy, Crypto: testProxyCrypto(t)})

	require.NoError(t, svc.SetMany([]model.SettingInput{
		model.SettingInputFrom(model.Setting{Key: applicationProxyModeSetting, Namespace: "application", Value: `"manual"`, ValueType: "string", Version: 1}),
		model.SettingInputFrom(model.Setting{Key: applicationProxyURLSetting, Namespace: "application", Value: `"http://127.0.0.1:1080"`, ValueType: "string", Version: 1}),
		model.SettingInputFrom(model.Setting{Key: applicationProxyPasswordSetting, Namespace: "application", Value: `"s3cret-pass"`, ValueType: "string", Version: 1}),
	}))
	assert.Equal(t, "s3cret-pass", proxy.config.Password)

	got, err := svc.Get(applicationProxyPasswordSetting)
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, `""`, got.Value)

	many, err := svc.GetMany([]string{applicationProxyPasswordSetting, applicationProxyPasswordSavedSetting})
	require.NoError(t, err)
	assert.Equal(t, `""`, many[applicationProxyPasswordSetting].Value)
	assert.Contains(t, many[applicationProxyPasswordSavedSetting].Value, "true")

	// Empty password keeps previous secret.
	require.NoError(t, svc.Set(model.SettingInputFrom(model.Setting{
		Key: applicationProxyPasswordSetting, Namespace: "application", Value: `""`, ValueType: "string", Version: 1,
	})))
	assert.Equal(t, "s3cret-pass", proxy.config.Password)

	// Clear sentinel removes secret.
	clearPayload, err := json.Marshal(proxyPasswordClearSentinel)
	require.NoError(t, err)
	require.NoError(t, svc.Set(model.SettingInputFrom(model.Setting{
		Key: applicationProxyPasswordSetting, Namespace: "application", Value: string(clearPayload), ValueType: "string", Version: 1,
	})))
	assert.Equal(t, "", proxy.config.Password)
}
