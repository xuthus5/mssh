package app

import (
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/netproxy"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestAppShutdownClosesApplicationHTTPIdleConnections(t *testing.T) {
	var connectionCount atomic.Int32
	target := httptest.NewUnstartedServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		_, _ = response.Write([]byte("ok"))
	}))
	target.Config.ConnState = func(_ net.Conn, state http.ConnState) {
		if state == http.StateNew {
			connectionCount.Add(1)
		}
	}
	target.Start()
	t.Cleanup(target.Close)

	manager := netproxy.New()
	require.NoError(t, manager.Configure(netproxy.Config{Mode: netproxy.ModeDirect}))
	client := manager.Client(2 * time.Second)
	require.NoError(t, appHTTPGet(client, target.URL))
	appInstance := &App{proxyManager: manager}

	appInstance.Shutdown()

	require.NoError(t, appHTTPGet(client, target.URL))
	assert.Equal(t, int32(2), connectionCount.Load())
}

func TestNewInstallsDefaultProxyManager(t *testing.T) {
	appInstance, err := New(Options{DataDir: t.TempDir(), Logger: testutil.NewTestLogger()})
	require.NoError(t, err)
	t.Cleanup(appInstance.Shutdown)

	assert.NotNil(t, appInstance.proxyManager)
}

func appHTTPGet(client *http.Client, endpoint string) error {
	response, err := client.Get(endpoint)
	if err != nil {
		return err
	}
	_, readErr := io.Copy(io.Discard, response.Body)
	closeErr := response.Body.Close()
	if readErr != nil {
		return readErr
	}
	return closeErr
}
