package netproxy

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestManagerSocks5RoutesHTTPWithAuthentication(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, _ = writer.Write([]byte("through-socks"))
	}))
	defer target.Close()
	proxy := newFakeSOCKSServer(t, "alice", "secret")
	manager := New()
	client := manager.Client(3 * time.Second)
	require.NoError(t, manager.Configure(Config{Mode: ModeManual, URL: proxy.URL("socks5"), Username: "alice", Password: "secret"}))

	response, err := client.Get(target.URL)
	require.NoError(t, err)
	body, err := io.ReadAll(response.Body)
	require.NoError(t, err)
	require.NoError(t, response.Body.Close())
	assert.Equal(t, "through-socks", string(body))
	assert.True(t, receiveAuth(t, proxy.auth))
	assert.Equal(t, target.Listener.Addr().String(), receiveRequest(t, proxy.requests))
}

func TestManagerSocks5HonorsNoProxy(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, _ = writer.Write([]byte("direct"))
	}))
	defer target.Close()
	proxy := newFakeSOCKSServer(t, "", "")
	manager := New()
	require.NoError(t, manager.Configure(Config{Mode: ModeManual, URL: proxy.URL("socks5"), NoProxy: "127.0.0.1"}))

	response, err := manager.Client(3 * time.Second).Get(target.URL)
	require.NoError(t, err)
	body, err := io.ReadAll(response.Body)
	require.NoError(t, err)
	require.NoError(t, response.Body.Close())
	assert.Equal(t, "direct", string(body))
	select {
	case request := <-proxy.requests:
		t.Fatalf("unexpected SOCKS request for %s", request)
	case <-time.After(100 * time.Millisecond):
	}
}

func TestManagerSocks5RejectsInvalidAuthentication(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer target.Close()
	proxy := newFakeSOCKSServer(t, "alice", "secret")
	manager := New()
	require.NoError(t, manager.Configure(Config{
		Mode: ModeManual, URL: proxy.URL("socks5"), Username: "alice", Password: "wrong",
	}))

	response, err := manager.Client(3 * time.Second).Get(target.URL)
	if response != nil {
		_ = response.Body.Close()
	}
	require.Error(t, err)
	assert.False(t, receiveAuth(t, proxy.auth))
}

func TestManagerSocks5HRoutesDomainTarget(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, _ = writer.Write([]byte("remote-dns"))
	}))
	defer target.Close()
	_, port, err := net.SplitHostPort(target.Listener.Addr().String())
	require.NoError(t, err)
	proxy := newFakeSOCKSServer(t, "", "")
	manager := New()
	require.NoError(t, manager.Configure(Config{Mode: ModeManual, URL: proxy.URL("socks5h")}))

	response, err := manager.Client(3 * time.Second).Get("http://localhost:" + port)
	require.NoError(t, err)
	_, err = io.Copy(io.Discard, response.Body)
	require.NoError(t, err)
	require.NoError(t, response.Body.Close())
	assert.Equal(t, net.JoinHostPort("localhost", port), receiveRequest(t, proxy.requests))
}

func TestManagerSocks5RejectsBlockedTargetBeforeProxyConnect(t *testing.T) {
	proxy := newFakeSOCKSServer(t, "", "")
	manager := New()
	require.NoError(t, manager.Configure(Config{Mode: ModeManual, URL: proxy.URL("socks5")}))
	transport := manager.Transport()
	_, err := transport.DialContext(context.Background(), "tcp", "metadata.google.internal:80")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not allowed")
	select {
	case request := <-proxy.requests:
		t.Fatalf("unexpected SOCKS request for %s", request)
	case <-time.After(100 * time.Millisecond):
	}
}

func receiveAuth(t *testing.T, values <-chan bool) bool {
	t.Helper()
	select {
	case value := <-values:
		return value
	case <-time.After(socksTestTimeout):
		t.Fatal("timed out waiting for SOCKS authentication")
		return false
	}
}

func receiveRequest(t *testing.T, values <-chan string) string {
	t.Helper()
	select {
	case value := <-values:
		return value
	case <-time.After(socksTestTimeout):
		t.Fatal("timed out waiting for SOCKS request")
		return ""
	}
}
