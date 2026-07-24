package netproxy

import (
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalizeAndValidate(t *testing.T) {
	assert.Equal(t, ModeSystem, NormalizeMode("unknown"))
	assert.Equal(t, ModeDirect, NormalizeMode("DIRECT"))
	assert.Equal(t, ModeManual, NormalizeMode("manual"))

	require.NoError(t, Validate(Config{Mode: ModeSystem}))
	require.NoError(t, Validate(Config{Mode: ModeDirect}))
	assert.Error(t, Validate(Config{Mode: ModeManual}))
	assert.Error(t, Validate(Config{Mode: ModeManual, URL: "ftp://proxy.local:1080"}))
	require.NoError(t, Validate(Config{Mode: ModeManual, URL: "http://127.0.0.1:1080"}))
	require.NoError(t, Validate(Config{Mode: ModeManual, URL: "socks5://127.0.0.1:1080"}))
	require.NoError(t, Validate(Config{Mode: ModeManual, URL: "http://proxy.local:8080"}))
	assert.Error(t, Validate(Config{Mode: ModeManual, URL: "http://user:pass@proxy.local:8080"}))
	assert.Error(t, Validate(Config{Mode: ModeManual, URL: "http://169.254.169.254:80"}))
	assert.Error(t, Validate(Config{Mode: ModeManual, URL: "socks5://metadata.google.internal:1080"}))
	assert.Error(t, Validate(Config{Mode: ModeManual, URL: "http://0.0.0.0:1080"}))
}

func TestManagerConfigureAndProxyModes(t *testing.T) {
	manager := New()
	require.Equal(t, ModeSystem, manager.Config().Mode)

	require.NoError(t, manager.Configure(Config{Mode: ModeDirect}))
	proxy, err := manager.proxyFunc()(&http.Request{URL: mustURL(t, "https://example.com")})
	require.NoError(t, err)
	assert.Nil(t, proxy)

	require.NoError(t, manager.Configure(Config{
		Mode: ModeManual, URL: "http://proxy.local:8080", Username: "u", Password: "p", NoProxy: "example.com,.internal",
	}))
	proxy, err = manager.proxyFunc()(&http.Request{URL: mustURL(t, "https://api.github.com")})
	require.NoError(t, err)
	require.NotNil(t, proxy)
	assert.Equal(t, "proxy.local:8080", proxy.Host)
	assert.Equal(t, "u", proxy.User.Username())
	password, ok := proxy.User.Password()
	assert.True(t, ok)
	assert.Equal(t, "p", password)

	proxy, err = manager.proxyFunc()(&http.Request{URL: mustURL(t, "https://example.com/path")})
	require.NoError(t, err)
	assert.Nil(t, proxy)

	proxy, err = manager.proxyFunc()(&http.Request{URL: mustURL(t, "https://svc.internal/x")})
	require.NoError(t, err)
	assert.Nil(t, proxy)

	client := manager.Client(5 * time.Second)
	require.NotNil(t, client.Transport)
}

func TestShouldBypass(t *testing.T) {
	assert.False(t, shouldBypass(mustURL(t, "https://a.com"), ""))
	assert.True(t, shouldBypass(mustURL(t, "https://a.com"), "*"))
	assert.True(t, shouldBypass(mustURL(t, "https://foo.bar.com"), ".bar.com"))
	assert.True(t, shouldBypass(mustURL(t, "https://bar.com"), "bar.com"))
	assert.False(t, shouldBypass(mustURL(t, "https://evilbar.com"), "bar.com"))
}

func mustURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	parsed, err := url.Parse(raw)
	require.NoError(t, err)
	return parsed
}

func TestNilManagerAndManualProxyURL(t *testing.T) {
	var m *Manager
	require.NoError(t, m.Configure(Config{Mode: ModeDirect}))
	assert.Equal(t, DefaultConfig().Mode, m.Config().Mode)
	client := m.Client(time.Second)
	require.NotNil(t, client)

	url, err := manualProxyURL(Config{URL: "http://proxy.example:8080", Username: "u", Password: "p"})
	require.NoError(t, err)
	require.NotNil(t, url.User)
	assert.Equal(t, "u", url.User.Username())
	pass, ok := url.User.Password()
	assert.True(t, ok)
	assert.Equal(t, "p", pass)

	url, err = manualProxyURL(Config{URL: "http://proxy.example:8080", Username: "u"})
	require.NoError(t, err)
	assert.Equal(t, "u", url.User.Username())

	assert.True(t, isBlockedProxyHost("metadata.google.internal"))
	assert.True(t, isBlockedProxyHost("169.254.169.254"))
	assert.False(t, isBlockedProxyHost("proxy.example"))
}
func TestNormalizeTrimsFields(t *testing.T) {
	got := Normalize(Config{Mode: " MANUAL ", URL: " http://p ", NoProxy: " a,b ", Username: " u ", Password: " p "})
	assert.Equal(t, ModeManual, got.Mode)
	assert.Equal(t, "http://p", got.URL)
	assert.Equal(t, "a,b", got.NoProxy)
	assert.Equal(t, "u", got.Username)
	assert.Equal(t, "p", got.Password)
}
