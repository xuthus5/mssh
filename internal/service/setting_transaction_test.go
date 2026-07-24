package service

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/netproxy"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

type failOnceProxyConfigurer struct {
	config    netproxy.Config
	err       error
	failNext  bool
	callCount int
}

func (p *failOnceProxyConfigurer) Configure(config netproxy.Config) error {
	p.callCount++
	if p.failNext {
		p.failNext = false
		return p.err
	}
	p.config = config
	return nil
}

func (p *failOnceProxyConfigurer) Config() netproxy.Config {
	return p.config
}

func TestSettingServiceRollsBackClearedProxySecretWhenRuntimeApplyFails(t *testing.T) {
	db := testutil.NewTestDB(t)
	proxy := &failOnceProxyConfigurer{config: netproxy.DefaultConfig(), err: errors.New("proxy apply failed")}
	runtime := testProxyCrypto(t)
	svc := NewSettingService(db, testutil.NewTestLogger(), SettingServiceOptions{Proxy: proxy, Crypto: runtime})
	require.NoError(t, svc.Set(model.SettingInputFrom(model.Setting{
		Key: applicationProxyPasswordSetting, Namespace: "application", Value: `"old-secret"`, ValueType: "string", Version: 1,
	})))
	clearPayload := `"` + proxyPasswordClearSentinel + `"`
	proxy.failNext = true
	err := svc.Set(model.SettingInputFrom(model.Setting{
		Key: applicationProxyPasswordSetting, Namespace: "application", Value: clearPayload, ValueType: "string", Version: 1,
	}))
	require.ErrorContains(t, err, "proxy apply failed")

	password, saved := svc.loadProxyPassword()
	assert.True(t, saved)
	assert.Equal(t, "old-secret", password)
	entry, err := store.GetSettingEntry(db, applicationProxyPasswordSetting)
	require.NoError(t, err)
	require.NotNil(t, entry)
	assert.NotEqual(t, `""`, entry.Value)
}

func TestSettingServiceRollsBackLogSettingsWhenRuntimeApplyFails(t *testing.T) {
	db := testutil.NewTestDB(t)
	log := &stubLogConfigurer{dir: "/tmp/original", retention: 9, err: errors.New("log apply failed")}
	svc := NewSettingService(db, testutil.NewTestLogger(), log)
	err := svc.Set(model.SettingInputFrom(model.Setting{
		Key: applicationLogRetentionSetting, Namespace: "application", Value: `14`, ValueType: "number", Version: 1,
	}))
	require.ErrorContains(t, err, "log apply failed")
	entry, err := store.GetSettingEntry(db, applicationLogRetentionSetting)
	require.NoError(t, err)
	assert.Nil(t, entry)
}
