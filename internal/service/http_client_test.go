package service

import (
	"context"
	"net"
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
	assert.NoError(t, validateOutboundHTTPURL("http://example.com"))
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
	next.Header.Set("X-Goog-Api-Key", "gemini-key")
	require.NoError(t, secureHTTPRedirect(next, []*http.Request{viaReq}))
	assert.Empty(t, next.Header.Get("Authorization"))
	assert.Empty(t, next.Header.Get("X-API-KEY"))
	assert.Empty(t, next.Header.Get("X-Goog-Api-Key"))
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
	// Policy allows non-loopback HTTP but still blocks SSRF hosts.
	blockedReq := &http.Request{URL: mustURL(t, "https://169.254.169.254/latest")}
	require.Error(t, client.CheckRedirect(blockedReq, nil))
	allowedReq := &http.Request{URL: mustURL(t, "http://example.com")}
	require.NoError(t, client.CheckRedirect(allowedReq, nil))
}

func mustURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	parsed, err := url.Parse(raw)
	require.NoError(t, err)
	return parsed
}

func TestIsBlockedOutboundIP(t *testing.T) {
	assert.True(t, isBlockedOutboundIP(net.ParseIP("169.254.169.254")))
	assert.True(t, isBlockedOutboundIP(net.ParseIP("0.0.0.0")))
	assert.True(t, isBlockedOutboundIP(net.ParseIP("ff02::1")))
	assert.False(t, isBlockedOutboundIP(net.ParseIP("127.0.0.1")))
	assert.False(t, isBlockedOutboundIP(net.ParseIP("1.1.1.1")))
	assert.False(t, isBlockedOutboundIP(net.ParseIP("10.0.0.1")))
}

func TestSecureDialContextBlocksMetadataIP(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, err := secureDialContext(ctx, "tcp", "169.254.169.254:80")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not allowed")
}

func TestSharedHTTPClientTransportHasSecureDial(t *testing.T) {
	client := sharedHTTPClient(2*time.Second, nil)
	transport, ok := client.Transport.(*http.Transport)
	require.True(t, ok)
	require.NotNil(t, transport.DialContext)
}

func TestSecureDialContextInvalidAddress(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, err := secureDialContext(ctx, "tcp", "not-a-valid-address")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid dial address")
}

func TestSecureDialContextBlocksHostnameMetadata(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	// metadata.google.internal is in the blocked hostname set; dial should fail before network.
	_, err := secureDialContext(ctx, "tcp", "metadata.google.internal:80")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not allowed")
}

func TestSecureDialContextAllowsLoopbackLiteral(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer ln.Close()
	go func() {
		conn, acceptErr := ln.Accept()
		if acceptErr == nil {
			_ = conn.Close()
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	conn, err := secureDialContext(ctx, "tcp", ln.Addr().String())
	require.NoError(t, err)
	require.NoError(t, conn.Close())
}

func TestSecureDialContextBlocksLinkLocalLiteral(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, err := secureDialContext(ctx, "tcp", "169.254.1.1:80")
	require.Error(t, err)
}

func TestSecureHTTPTransportUnknownBase(t *testing.T) {
	// Non-*http.Transport base falls through to DefaultTransport clone path.
	transport := secureHTTPTransport(roundTripperFunc(func(*http.Request) (*http.Response, error) {
		return nil, context.Canceled
	}))
	require.NotNil(t, transport)
	require.NotNil(t, transport.DialContext)
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestSecureHTTPRedirectNilRequest(t *testing.T) {
	require.Error(t, secureHTTPRedirect(nil, nil))
}

func TestIsBlockedOutboundIPNil(t *testing.T) {
	assert.False(t, isBlockedOutboundIP(nil))
}

func TestSyncHTTPClientHelpers(t *testing.T) {
	client := syncHTTPClient()
	require.NotNil(t, client)
	require.NotNil(t, client.CheckRedirect)

	svc := &SyncService{}
	client = svc.syncHTTPClient()
	require.NotNil(t, client)
}

func TestFirstProxy(t *testing.T) {
	assert.Nil(t, firstProxy())
	manager := netproxy.New()
	assert.Same(t, manager, firstProxy(manager))
}

func TestSecureDialContextHostnameLoopback(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer ln.Close()
	_, port, err := net.SplitHostPort(ln.Addr().String())
	require.NoError(t, err)
	go func() {
		conn, acceptErr := ln.Accept()
		if acceptErr == nil {
			_ = conn.Close()
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	conn, err := secureDialContext(ctx, "tcp", net.JoinHostPort("localhost", port))
	require.NoError(t, err)
	require.NoError(t, conn.Close())
}

func TestSecureDialContextUnresolvableHost(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, err := secureDialContext(ctx, "tcp", "this-host-should-not-resolve.invalid:80")
	require.Error(t, err)
}

func TestValidateOutboundHTTPURLEmptyHost(t *testing.T) {
	assert.Error(t, validateOutboundHTTPURL("https://"))
	assert.Error(t, validateOutboundHTTPURL("://missing"))
}

func TestSecureDialContextSkipsBlockedResolvedIPs(t *testing.T) {
	orig := lookupIPAddr
	t.Cleanup(func() { lookupIPAddr = orig })

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer ln.Close()
	_, port, err := net.SplitHostPort(ln.Addr().String())
	require.NoError(t, err)
	go func() {
		conn, acceptErr := ln.Accept()
		if acceptErr == nil {
			_ = conn.Close()
		}
	}()

	lookupIPAddr = func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{
			{IP: net.ParseIP("169.254.169.254")},
			{IP: net.ParseIP("127.0.0.1")},
		}, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	conn, err := secureDialContext(ctx, "tcp", net.JoinHostPort("example.test", port))
	require.NoError(t, err)
	require.NoError(t, conn.Close())
}

func TestSecureDialContextAllResolvedIPsBlocked(t *testing.T) {
	orig := lookupIPAddr
	t.Cleanup(func() { lookupIPAddr = orig })
	lookupIPAddr = func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("169.254.1.1")}, {IP: net.ParseIP("0.0.0.0")}}, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, err := secureDialContext(ctx, "tcp", "example.test:80")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not allowed")
}

func TestSecureDialContextNoResolvedAddresses(t *testing.T) {
	orig := lookupIPAddr
	t.Cleanup(func() { lookupIPAddr = orig })
	lookupIPAddr = func(context.Context, string) ([]net.IPAddr, error) {
		return nil, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, err := secureDialContext(ctx, "tcp", "example.test:80")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no usable addresses")
}

func TestSecureDialContextDialFailureUsesLastErr(t *testing.T) {
	orig := lookupIPAddr
	t.Cleanup(func() { lookupIPAddr = orig })
	lookupIPAddr = func(context.Context, string) ([]net.IPAddr, error) {
		// Unroutable documentation range; connection should fail quickly.
		return []net.IPAddr{{IP: net.ParseIP("192.0.2.1")}}, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	_, err := secureDialContext(ctx, "tcp", "example.test:1")
	require.Error(t, err)
}
