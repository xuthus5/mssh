package service

import (
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

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

type blockingLogConfigurer struct {
	mu           sync.Mutex
	dir          string
	retention    int
	firstStarted chan struct{}
	releaseFirst chan struct{}
}

func (c *blockingLogConfigurer) Configure(dir string, retention int) error {
	if retention == 10 {
		close(c.firstStarted)
		<-c.releaseFirst
	}
	c.mu.Lock()
	c.dir, c.retention = dir, retention
	c.mu.Unlock()
	return nil
}

func (c *blockingLogConfigurer) Dir() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.dir
}

func (c *blockingLogConfigurer) RetentionDays() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.retention
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
	proxy.failNext = true
	err := svc.Set(model.SettingInputFrom(model.Setting{
		Key: applicationProxyPasswordSetting, Namespace: "application", Value: "null", ValueType: "null", Version: 1,
	}))
	require.ErrorContains(t, err, "proxy apply failed")

	password, saved, loadErr := svc.loadProxyPassword()
	require.NoError(t, loadErr)
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

func TestSettingServiceSerializesRuntimeSettingChanges(t *testing.T) {
	db := testutil.NewTestDB(t)
	log := &blockingLogConfigurer{
		dir: "/tmp/logs", retention: 9,
		firstStarted: make(chan struct{}), releaseFirst: make(chan struct{}),
	}
	svc := NewSettingService(db, testutil.NewTestLogger(), log)
	firstDone := make(chan error, 1)
	secondDone := make(chan error, 1)
	go func() { firstDone <- svc.Set(logRetentionInput(10)) }()
	<-log.firstStarted
	go func() { secondDone <- svc.Set(logRetentionInput(20)) }()

	select {
	case err := <-secondDone:
		t.Fatalf("second save bypassed the active save: %v", err)
	case <-time.After(20 * time.Millisecond):
	}
	close(log.releaseFirst)
	require.NoError(t, <-firstDone)
	require.NoError(t, <-secondDone)
	assert.Equal(t, 20, log.RetentionDays())
	entry, err := store.GetSettingEntry(db, applicationLogRetentionSetting)
	require.NoError(t, err)
	require.NotNil(t, entry)
	assert.Equal(t, "20", entry.Value)
}

func logRetentionInput(retention int) model.SettingInput {
	return model.SettingInputFrom(model.Setting{
		Key: applicationLogRetentionSetting, Namespace: "application",
		Value: fmt.Sprint(retention), ValueType: "number", Version: 1,
	})
}
