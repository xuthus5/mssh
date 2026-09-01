package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
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
}

func TestWailsWSTransportHTTPRPCText(t *testing.T) {
	transport, _ := startTestWSTransport(t, func(_ context.Context, req *application.RuntimeRequest) (any, error) {
		assert.Equal(t, 1, req.Object)
		assert.Equal(t, 2, req.Method)
		return "hello", nil
	})
	handler := transport.Handler()(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("next handler should not be reached for /wails/runtime")
	}))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/wails/runtime", strings.NewReader(`{"object":1,"method":2}`))
	handler.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "text/plain", rec.Header().Get("Content-Type"))
	assert.Equal(t, "hello", rec.Body.String())
}

func TestWailsWSTransportHTTPRPCJSON(t *testing.T) {
	transport, _ := startTestWSTransport(t, func(context.Context, *application.RuntimeRequest) (any, error) {
		return map[string]any{"count": 3}, nil
	})
	handler := transport.Handler()(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Fatal("unexpected next") }))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/wails/runtime", strings.NewReader(`{"object":1,"method":2}`))
	handler.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "application/json", rec.Header().Get("Content-Type"))
	assert.JSONEq(t, `{"count":3}`, rec.Body.String())
}

func TestWailsWSTransportHTTPRPCError(t *testing.T) {
	transport, _ := startTestWSTransport(t, func(context.Context, *application.RuntimeRequest) (any, error) {
		return nil, errTestCall
	})
	handler := transport.Handler()(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Fatal("unexpected next") }))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/wails/runtime", strings.NewReader(`{"object":1,"method":2}`))
	handler.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Contains(t, rec.Body.String(), "test call failed")
}

func TestWailsWSTransportHTTPRPCRejectsMalformed(t *testing.T) {
	transport, _ := startTestWSTransport(t, func(context.Context, *application.RuntimeRequest) (any, error) {
		t.Fatal("handler must not run for malformed request")
		return nil, nil
	})
	handler := transport.Handler()(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Fatal("unexpected next") }))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/wails/runtime", strings.NewReader(`not-json`))
	handler.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestWailsWSTransportHTTPRPCWithoutProcessor(t *testing.T) {
	transport, _ := startTestWSTransport(t, nil)
	handler := transport.Handler()(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Fatal("unexpected next") }))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/wails/runtime", strings.NewReader(`{"object":1,"method":2}`))
	handler.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusInternalServerError, rec.Code)
}

func TestWailsWSTransportPassesUnknownPathsToNext(t *testing.T) {
	transport, _ := startTestWSTransport(t, nil)
	called := false
	handler := transport.Handler()(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true }))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/index.html", nil))
	assert.True(t, called)
}

func TestWailsWSTransportRPCTextResponse(t *testing.T) {
	_, url := startTestWSTransport(t, func(_ context.Context, req *application.RuntimeRequest) (any, error) {
		assert.Equal(t, 1, req.Object)
		assert.Equal(t, 2, req.Method)
		assert.NotNil(t, req.Args)
		assert.Equal(t, `{"x":1}`, req.Args.String())
		return "hello", nil
	})
	conn := dialWSTransport(t, url)
	require.NoError(t, conn.Write(context.Background(), websocket.MessageText, []byte(`{"id":"req-1","object":1,"method":2,"args":{"x":1}}`)))
	message := readWSMessage(t, conn)
	assert.Equal(t, "req-1", message["id"])
	assert.Equal(t, true, message["ok"])
	assert.Equal(t, "text", message["type"])
	assert.Equal(t, "hello", message["data"])
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
