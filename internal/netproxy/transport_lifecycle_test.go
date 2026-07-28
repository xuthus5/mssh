package netproxy

import (
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestManagerClientStopsUsingIdleConnectionAfterProxyChange(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		_, _ = response.Write([]byte("ok"))
	}))
	t.Cleanup(target.Close)
	proxyListener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	t.Cleanup(func() { _ = proxyListener.Close() })
	proxyAccepted := make(chan struct{})
	go func() {
		connection, acceptErr := proxyListener.Accept()
		if acceptErr == nil {
			_ = connection.Close()
		}
		close(proxyAccepted)
	}()

	manager := New()
	require.NoError(t, manager.Configure(Config{Mode: ModeDirect}))
	client := manager.Client(2 * time.Second)
	require.NoError(t, performHTTPGet(client, target.URL))
	require.NoError(t, manager.Configure(Config{Mode: ModeManual, URL: "socks5://" + proxyListener.Addr().String()}))

	err = performHTTPGet(client, target.URL)
	require.Error(t, err)
	assert.Eventually(t, func() bool {
		select {
		case <-proxyAccepted:
			return true
		default:
			return false
		}
	}, time.Second, 10*time.Millisecond)
}

func TestManagerClientsSharePoolAndCloseIdleConnections(t *testing.T) {
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

	manager := New()
	require.NoError(t, manager.Configure(Config{Mode: ModeDirect}))
	firstClient := manager.Client(2 * time.Second)
	secondClient := manager.Client(2 * time.Second)
	require.NoError(t, performHTTPGet(firstClient, target.URL))
	require.NoError(t, manager.Configure(Config{Mode: ModeDirect}))
	require.NoError(t, performHTTPGet(secondClient, target.URL))
	assert.Equal(t, int32(1), connectionCount.Load())
	require.Error(t, manager.Configure(Config{Mode: ModeManual, URL: "ftp://invalid"}))
	require.NoError(t, performHTTPGet(secondClient, target.URL))
	assert.Equal(t, int32(1), connectionCount.Load())

	manager.CloseIdleConnections()
	require.NoError(t, performHTTPGet(firstClient, target.URL))
	assert.Equal(t, int32(2), connectionCount.Load())
}

func TestManagerRoundTripperSupportsZeroValueAndRejectsInvalidInput(t *testing.T) {
	var nilManager *Manager
	_, err := nilManager.RoundTrip(&http.Request{})
	assert.ErrorContains(t, err, "manager is required")
	nilManager.CloseIdleConnections()

	manager := &Manager{}
	_, err = manager.RoundTrip(nil)
	assert.ErrorContains(t, err, "request is required")
	client := manager.Client(2 * time.Second)
	assert.Equal(t, ModeSystem, manager.Config().Mode)

	target := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		_, _ = response.Write([]byte("ok"))
	}))
	t.Cleanup(target.Close)
	require.NoError(t, performHTTPGet(client, target.URL))
}

func TestManagerConcurrentReconfigurationAndClientAccess(t *testing.T) {
	manager := New()
	configs := []Config{{Mode: ModeDirect}, {Mode: ModeSystem}}
	const workers = 8
	const iterations = 50
	errorResults := make(chan error, workers*iterations)
	start := make(chan struct{})
	exercise := managerConcurrencyExercise{
		manager: manager, configs: configs, iterations: iterations, start: start, errors: errorResults,
	}
	var waitGroup sync.WaitGroup
	for worker := range workers {
		waitGroup.Add(1)
		go exercise.run(worker, &waitGroup)
	}
	close(start)
	waitGroup.Wait()
	close(errorResults)
	for err := range errorResults {
		require.NoError(t, err)
	}
}

type managerConcurrencyExercise struct {
	manager    *Manager
	configs    []Config
	iterations int
	start      <-chan struct{}
	errors     chan<- error
}

func (exercise managerConcurrencyExercise) run(worker int, waitGroup *sync.WaitGroup) {
	defer waitGroup.Done()
	<-exercise.start
	for iteration := range exercise.iterations {
		if (worker+iteration)%2 == 0 {
			exercise.errors <- exercise.manager.Configure(exercise.configs[iteration%len(exercise.configs)])
			continue
		}
		_ = exercise.manager.Client(time.Second)
		_ = exercise.manager.Config()
		exercise.manager.CloseIdleConnections()
	}
}

func performHTTPGet(client *http.Client, endpoint string) error {
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
