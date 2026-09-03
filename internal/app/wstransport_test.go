package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

var errTestCall = errors.New("test call failed")

func startTestWSTransport(t *testing.T, handler runtimeCallFn) (*wailsWSTransport, string) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	transport := NewWailsWSTransport(logger)
	require.NoError(t, transport.Start(ctx, nil))
	if handler != nil {
		transport.runtimeCall = handler
	}
	t.Cleanup(func() { _ = transport.Stop() })
	return transport, transport.wsURL
}

func dialWSTransport(t *testing.T, url string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, url, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = conn.Close(websocket.StatusNormalClosure, "") })
	return conn
}

// waitClientCount waits until the transport has registered the given number of
// WebSocket clients. websocket.Dial returns as soon as the TCP upgrade lands,
// but the server registers the client on its own goroutine shortly after, so
// assertions against clientCount must wait for registration to avoid flakes.
func waitClientCount(t *testing.T, transport *wailsWSTransport, want int) {
	t.Helper()
	require.Eventually(t, func() bool { return transport.clientCount() == want }, 3*time.Second, 10*time.Millisecond)
}

func readWSMessage(t *testing.T, conn *websocket.Conn) map[string]any {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, data, err := conn.Read(ctx)
	require.NoError(t, err)
	var message map[string]any
	require.NoError(t, json.Unmarshal(data, &message))
	return message
}

func TestWailsWSTransportJSClientExposesWSURL(t *testing.T) {
	transport, url := startTestWSTransport(t, nil)
	client := string(transport.JSClient())
	assert.Contains(t, client, "window.__wailsWSURL")
	assert.Contains(t, client, url)
	assert.Contains(t, url, "token=")
}

func TestWailsWSTransportRejectsInvalidToken(t *testing.T) {
	transport, url := startTestWSTransport(t, nil)
	invalidURL := strings.Replace(url, transport.token, "invalid", 1)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _, err := websocket.Dial(ctx, invalidURL, nil)
	assert.Error(t, err)
}

func TestWailsWSTransportRPCTextResponse(t *testing.T) {
	_, url := startTestWSTransport(t, func(_ context.Context, req *application.RuntimeRequest) (any, error) {
		assert.Equal(t, 1, req.Object)
		assert.Equal(t, 2, req.Method)
		assert.Equal(t, "client-1", req.ClientID)
		assert.NotNil(t, req.Args)
		assert.Equal(t, `{"x":1}`, req.Args.String())
		return "hello", nil
	})
	conn := dialWSTransport(t, url)
	require.NoError(t, conn.Write(context.Background(), websocket.MessageText, []byte(`{"type":"call","id":"req-1","object":1,"method":2,"args":{"x":1},"clientId":"client-1"}`)))
	message := readWSMessage(t, conn)
	assert.Equal(t, "req-1", message["id"])
	assert.Equal(t, true, message["ok"])
	assert.Equal(t, "text", message["type"])
	assert.Equal(t, "hello", message["data"])
}

func TestWailsWSTransportDoesNotBlockSubsequentCallsOnSlowCall(t *testing.T) {
	_, url := startTestWSTransport(t, func(ctx context.Context, req *application.RuntimeRequest) (any, error) {
		if req.Method == 1 {
			<-ctx.Done()
			return nil, ctx.Err()
		}
		return "fast", nil
	})
	conn := dialWSTransport(t, url)
	require.NoError(t, conn.Write(context.Background(), websocket.MessageText, []byte(`{"type":"call","id":"slow","object":0,"method":1}`)))
	require.NoError(t, conn.Write(context.Background(), websocket.MessageText, []byte(`{"type":"call","id":"fast","object":0,"method":2}`)))
	message := readWSMessage(t, conn)
	assert.Equal(t, "fast", message["data"])
	assert.Equal(t, "fast", message["id"])
}

func TestWailsWSTransportTerminalInputFastPath(t *testing.T) {
	transport, url := startTestWSTransport(t, nil)
	transport.SetTerminalInputHandler(func(terminalID, data string) (int, error) {
		assert.Equal(t, "term-1", terminalID)
		assert.Equal(t, "ls\r", data)
		return len(data), nil
	})
	conn := dialWSTransport(t, url)
	request := `{"type":"terminal_input","id":"input-1","terminalID":"term-1","data":"ls\r"}`
	require.NoError(t, conn.Write(context.Background(), websocket.MessageText, []byte(request)))
	message := readWSMessage(t, conn)
	assert.Equal(t, "input-1", message["id"])
	assert.Equal(t, true, message["ok"])
	assert.Equal(t, "json", message["type"])
	assert.Equal(t, "3", message["data"])
}

func TestWailsWSTransportPreservesTerminalInputOrder(t *testing.T) {
	transport, url := startTestWSTransport(t, nil)
	var received []string
	var mu sync.Mutex
	transport.SetTerminalInputHandler(func(_, data string) (int, error) {
		mu.Lock()
		received = append(received, data)
		mu.Unlock()
		return len(data), nil
	})
	conn := dialWSTransport(t, url)
	for index := 0; index < 32; index++ {
		request := fmt.Sprintf(`{"type":"terminal_input","id":"input-%d","terminalID":"term-1","data":"%d"}`, index, index)
		require.NoError(t, conn.Write(context.Background(), websocket.MessageText, []byte(request)))
	}
	for range 32 {
		_ = readWSMessage(t, conn)
	}
	mu.Lock()
	defer mu.Unlock()
	require.Len(t, received, 32)
	for index, value := range received {
		assert.Equal(t, strconv.Itoa(index), value)
	}
}

func TestWailsWSTransportTerminalInputRequiresHandler(t *testing.T) {
	_, url := startTestWSTransport(t, nil)
	conn := dialWSTransport(t, url)
	require.NoError(t, conn.Write(context.Background(), websocket.MessageText, []byte(`{"type":"terminal_input","id":"input-2","terminalID":"term-1","data":"x"}`)))
	message := readWSMessage(t, conn)
	assert.Equal(t, false, message["ok"])
	assert.Equal(t, "terminal input handler is not configured", message["error"])
}

func TestWailsWSTransportDispatchesEventsToConnectedClients(t *testing.T) {
	transport, url := startTestWSTransport(t, nil)
	conn := dialWSTransport(t, url)
	waitClientCount(t, transport, 1)
	transport.DispatchWailsEvent(&application.CustomEvent{Name: "session:state", Data: map[string]any{"state": "connected"}})
	message := readWSMessage(t, conn)
	assert.Equal(t, "event", message["type"])
	eventPayload, ok := message["event"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "session:state", eventPayload["name"])
}

func TestWailsWSTransportRPCJSONResponse(t *testing.T) {
	_, url := startTestWSTransport(t, func(context.Context, *application.RuntimeRequest) (any, error) {
		return map[string]any{"count": 7}, nil
	})
	conn := dialWSTransport(t, url)
	require.NoError(t, conn.Write(context.Background(), websocket.MessageText, []byte(`{"id":"req-2","object":1,"method":2}`)))
	message := readWSMessage(t, conn)
	assert.Equal(t, "req-2", message["id"])
	assert.Equal(t, true, message["ok"])
	assert.Equal(t, "json", message["type"])
	var decoded map[string]any
	require.NoError(t, json.Unmarshal([]byte(message["data"].(string)), &decoded))
	assert.Equal(t, float64(7), decoded["count"])
}

func TestWailsWSTransportRPCErrorResponse(t *testing.T) {
	_, url := startTestWSTransport(t, func(context.Context, *application.RuntimeRequest) (any, error) {
		return nil, errTestCall
	})
	conn := dialWSTransport(t, url)
	require.NoError(t, conn.Write(context.Background(), websocket.MessageText, []byte(`{"id":"req-3","object":1,"method":2}`)))
	message := readWSMessage(t, conn)
	assert.Equal(t, "req-3", message["id"])
	assert.Equal(t, false, message["ok"])
	assert.Contains(t, message["error"], "test call failed")
}

func TestWailsWSTransportRPCWithoutProcessor(t *testing.T) {
	_, url := startTestWSTransport(t, nil)
	conn := dialWSTransport(t, url)
	require.NoError(t, conn.Write(context.Background(), websocket.MessageText, []byte(`{"id":"req-4","object":1,"method":2}`)))
	message := readWSMessage(t, conn)
	assert.Equal(t, false, message["ok"])
	assert.Equal(t, "wails runtime not started", message["error"])
}

func TestWailsWSTransportIgnoresInvalidRPC(t *testing.T) {
	var called atomic.Bool
	_, url := startTestWSTransport(t, func(context.Context, *application.RuntimeRequest) (any, error) {
		called.Store(true)
		return nil, nil
	})
	conn := dialWSTransport(t, url)
	require.NoError(t, conn.Write(context.Background(), websocket.MessageText, []byte(`not-json`)))
	require.NoError(t, conn.Write(context.Background(), websocket.MessageText, []byte(`{"id":"","object":1,"method":2}`)))
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	_, _, err := conn.Read(ctx)
	assert.Error(t, err, "malformed requests must not produce a response")
	assert.False(t, called.Load(), "handler must not be called for malformed requests")
}

func TestWailsWSTransportStopClosesServer(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	transport := NewWailsWSTransport(logger)
	require.NoError(t, transport.Start(ctx, nil))
	require.NotEmpty(t, transport.wsURL)
	require.NoError(t, transport.Stop())
	require.NoError(t, transport.Stop())
}

func TestWailsWSTransportClientRemovalOnDisconnect(t *testing.T) {
	transport, url := startTestWSTransport(t, nil)
	conn := dialWSTransport(t, url)
	waitClientCount(t, transport, 1)
	require.NoError(t, conn.Close(websocket.StatusNormalClosure, ""))
	require.Eventually(t, func() bool { return transport.clientCount() == 0 }, 3*time.Second, 20*time.Millisecond)
}
