package netproxy

import (
	"context"
	"errors"
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSecureDialContextRejectsInvalidInputs(t *testing.T) {
	tests := []struct {
		name    string
		ctx     context.Context
		network string
		address string
	}{
		{name: "nil context", network: "tcp", address: "127.0.0.1:80"},
		{name: "unsupported network", ctx: context.Background(), network: "udp", address: "127.0.0.1:80"},
		{name: "invalid address", ctx: context.Background(), network: "tcp", address: "invalid"},
		{name: "empty host", ctx: context.Background(), network: "tcp", address: ":80"},
		{name: "blocked IP", ctx: context.Background(), network: "tcp", address: "169.254.169.254:80"},
		{name: "blocked hostname", ctx: context.Background(), network: "tcp", address: "metadata.google.internal.:80"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := secureDialContext(test.ctx, test.network, test.address)
			assert.Error(t, err)
		})
	}
}

func TestSecureDialContextFiltersResolvedAddresses(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer listener.Close()
	_, port, err := net.SplitHostPort(listener.Addr().String())
	require.NoError(t, err)
	accepted := make(chan struct{})
	go func() {
		connection, acceptErr := listener.Accept()
		if acceptErr == nil {
			_ = connection.Close()
		}
		close(accepted)
	}()

	originalLookup := lookupProxyIPAddr
	t.Cleanup(func() { lookupProxyIPAddr = originalLookup })
	lookupProxyIPAddr = func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{
			{IP: net.ParseIP("169.254.169.254")},
			{IP: net.ParseIP("127.0.0.1")},
		}, nil
	}
	connection, err := secureDialContext(context.Background(), "tcp", net.JoinHostPort("proxy.test", port))
	require.NoError(t, err)
	require.NoError(t, connection.Close())
	select {
	case <-accepted:
	case <-time.After(time.Second):
		t.Fatal("resolved dial was not accepted")
	}
}

func TestSecureDialContextResolverFailures(t *testing.T) {
	originalLookup := lookupProxyIPAddr
	t.Cleanup(func() { lookupProxyIPAddr = originalLookup })

	lookupProxyIPAddr = func(context.Context, string) ([]net.IPAddr, error) {
		return nil, assert.AnError
	}
	_, err := secureDialContext(context.Background(), "tcp", "proxy.test:80")
	assert.ErrorIs(t, err, assert.AnError)

	lookupProxyIPAddr = func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("169.254.1.1")}}, nil
	}
	_, err = secureDialContext(context.Background(), "tcp", "proxy.test:80")
	assert.ErrorContains(t, err, "not allowed")

	lookupProxyIPAddr = func(context.Context, string) ([]net.IPAddr, error) { return nil, nil }
	_, err = secureDialContext(context.Background(), "tcp", "proxy.test:80")
	assert.ErrorContains(t, err, "no usable addresses")
}

func TestSafeDirectDialerDial(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer listener.Close()
	go func() {
		connection, acceptErr := listener.Accept()
		if acceptErr == nil {
			_ = connection.Close()
		}
	}()

	connection, err := (safeDirectDialer{}).Dial("tcp", listener.Addr().String())
	require.NoError(t, err)
	require.NoError(t, connection.Close())
}

func TestSOCKSHelpersRejectInvalidTargets(t *testing.T) {
	tests := []struct {
		name, network, address string
	}{
		{name: "network", network: "udp", address: "example.com:80"},
		{name: "address", network: "tcp", address: "invalid"},
		{name: "empty host", network: "tcp", address: ":80"},
		{name: "blocked host", network: "tcp", address: "metadata.goog:80"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assert.Error(t, validateSOCKSTarget(test.network, test.address))
		})
	}
	assert.NoError(t, validateSOCKSTarget("tcp", "example.com:443"))
	assert.False(t, shouldBypassAddress("invalid", "example.com"))
	assert.True(t, shouldBypassAddress("api.example.com:443", ".example.com"))
}

func TestDialSOCKSContextRejectsUnknownScheme(t *testing.T) {
	_, err := dialSOCKSContext(context.Background(), "tcp", "example.com:443", mustURL(t, "ftp://127.0.0.1:21"))
	assert.ErrorContains(t, err, "create SOCKS proxy dialer")
}

func TestProxyFuncRejectsMissingRequestURL(t *testing.T) {
	manager := New()
	_, err := manager.proxyFunc()(nil)
	assert.Error(t, err)
	_, err = manager.proxyFunc()(&http.Request{})
	assert.Error(t, err)
}

func TestManualProxyURLRejectsMalformedURL(t *testing.T) {
	_, err := manualProxyURL(Config{URL: "%gh"})
	assert.Error(t, err)
}

func TestNormalizeHostAndBlockedProxyIP(t *testing.T) {
	assert.Equal(t, "example.com", normalizeHost("example.com..."))
	assert.Equal(t, ".", normalizeHost("."))
	assert.False(t, isBlockedProxyIP(nil))
	assert.True(t, isBlockedProxyIP(net.ParseIP("ff02::1")))
	assert.False(t, isBlockedProxyIP(net.ParseIP("127.0.0.1")))
	assert.True(t, isSupportedDialNetwork("tcp6"))
	assert.False(t, isSupportedDialNetwork("unix"))
}

func TestSecureDialContextReturnsConnectionFailure(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	address := listener.Addr().String()
	require.NoError(t, listener.Close())
	_, err = secureDialContext(context.Background(), "tcp", address)
	assert.Error(t, err)
	assert.False(t, errors.Is(err, context.Canceled))
}
