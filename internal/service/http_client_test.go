package service

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/netproxy"
)

func TestValidateOutboundHTTPURL(t *testing.T) {
	assert.NoError(t, validateOutboundHTTPURL("https://api.openai.com/v1"))
	assert.NoError(t, validateOutboundHTTPURL("http://127.0.0.1:11434"))
	assert.NoError(t, validateOutboundHTTPURL("http://localhost:11434"))
	assert.Error(t, validateOutboundHTTPURL("http://example.com"))
	assert.Error(t, validateOutboundHTTPURL("https://169.254.169.254/latest"))
	assert.Error(t, validateOutboundHTTPURL("https://metadata.google.internal/"))
	assert.Error(t, validateOutboundHTTPURL("https://user:pass@api.openai.com"))
	assert.Error(t, validateOutboundHTTPURL("file:///etc/passwd"))
	assert.Error(t, validateOutboundHTTPURL("http://0.0.0.0:1"))
}

func TestSecureHTTPRedirectBlocksMetadataAndStripsAuth(t *testing.T) {
	req, err := http.NewRequest(http.MethodGet, "https://169.254.169.254/latest", nil)
	require.NoError(t, err)
	viaReq, err := http.NewRequest(http.MethodGet, "https://api.example.com/start", nil)
	require.NoError(t, err)
	viaReq.Header.Set("Authorization", "Bearer secret")
	err = secureHTTPRedirect(req, []*http.Request{viaReq})
	require.Error(t, err)

	// Cross-host redirect strips secrets.
	next, err := http.NewRequest(http.MethodGet, "https://cdn.example.com/next", nil)
	require.NoError(t, err)
	next.Header.Set("Authorization", "Bearer secret")
	next.Header.Set("X-API-KEY", "k")
	require.NoError(t, secureHTTPRedirect(next, []*http.Request{viaReq}))
	assert.Empty(t, next.Header.Get("Authorization"))
	assert.Empty(t, next.Header.Get("X-API-KEY"))
}

func TestSecureHTTPRedirectLimitsHops(t *testing.T) {
	req, err := http.NewRequest(http.MethodGet, "https://example.com/final", nil)
	require.NoError(t, err)
	via := make([]*http.Request, maxHTTPRedirects)
	for i := range via {
		via[i], err = http.NewRequest(http.MethodGet, "https://example.com/hop", nil)
		require.NoError(t, err)
	}
	require.Error(t, secureHTTPRedirect(req, via))
}

func TestSharedHTTPClientBlocksRedirectToMetadata(t *testing.T) {
	// Start a redirect chain: loopback -> metadata IP (blocked).
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://169.254.169.254/latest/meta-data", http.StatusFound)
	}))
	defer target.Close()

	client := sharedHTTPClient(3*time.Second, nil)
	req, err := http.NewRequest(http.MethodGet, target.URL, nil)
	require.NoError(t, err)
	resp, err := client.Do(req)
	if resp != nil {
		_ = resp.Body.Close()
	}
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not allowed")
}

func TestSharedHTTPClientWithProxyManager(t *testing.T) {
	manager := netproxy.New()
	require.NoError(t, manager.Configure(netproxy.Config{Mode: netproxy.ModeDirect}))
	client := sharedHTTPClient(2*time.Second, manager)
	require.NotNil(t, client.CheckRedirect)
	// Policy should reject non-loopback HTTP even for crafted redirect requests.
	req := &http.Request{URL: mustURL(t, "http://example.com")}
	require.Error(t, client.CheckRedirect(req, nil))
}

func mustURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	parsed, err := url.Parse(raw)
	require.NoError(t, err)
	return parsed
}
