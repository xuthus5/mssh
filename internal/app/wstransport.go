package app

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// wailsWSClient tracks one frontend WebSocket connection. All outbound frames
// (RPC responses and events) go through a single writer goroutine so frames are
// delivered to the frontend in the order wails emitted them.
type wailsWSClient struct {
	conn    *websocket.Conn
	writeCh chan []byte
}

func (c *wailsWSClient) writeLoop(ctx context.Context) {
	for {
		select {
		case payload := <-c.writeCh:
			writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			err := c.conn.Write(writeCtx, websocket.MessageText, payload)
			cancel()
			if err != nil {
				return
			}
		case <-ctx.Done():
			return
		}
	}
}

// runtimeCallFn executes a single runtime call. Production uses wails'
// MessageProcessor; tests inject a fake to cover the transport protocol
// without booting the whole application (which requires a global wails App).
type runtimeCallFn func(ctx context.Context, req *application.RuntimeRequest) (any, error)

// wailsWSTransport replaces wails' default HTTP-fetch RPC bridge with a local
// TCP WebSocket when the frontend connects. The webview's wails:// scheme
// cannot host WebSockets (the asset server rejects upgrades), so the frontend
// connects to 127.0.0.1:random, which WebKitGTK/WebView2/WKWebView natively
// support.
//
// Only RPC is transported over WebSocket. Events intentionally stay on wails'
// default ExecJS bridge (EventIPCTransport): wails' dispatchWailsEvent ->
// eventListeners path proved unreliable for WebSocket-delivered events in
// WebKitGTK, so routing events through ExecJS keeps every event feature
// (host key confirmation, transfer progress, terminal state) working.
// The transport still serves /wails/runtime over HTTP as an RPC fallback.
type wailsWSTransport struct {
	messageProcessor *application.MessageProcessor
	logger           *slog.Logger
	server           *http.Server
	wsURL            string
	runtimeCall      runtimeCallFn
	mu               sync.RWMutex
	clients          map[*websocket.Conn]*wailsWSClient
}

// NewWailsWSTransport creates the local TCP WebSocket IPC transport.
func NewWailsWSTransport(logger *slog.Logger) *wailsWSTransport {
	return &wailsWSTransport{logger: logger, clients: make(map[*websocket.Conn]*wailsWSClient)}
}

func (t *wailsWSTransport) Start(ctx context.Context, messageProcessor *application.MessageProcessor) error {
	t.messageProcessor = messageProcessor
	if messageProcessor == nil {
		t.runtimeCall = nil
	} else {
		t.runtimeCall = func(callCtx context.Context, req *application.RuntimeRequest) (any, error) {
			return messageProcessor.HandleRuntimeCallWithIDs(callCtx, req)
		}
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("start ws transport listener: %w", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	t.wsURL = fmt.Sprintf("ws://127.0.0.1:%d/wails/ws", port)
	mux := http.NewServeMux()
	mux.HandleFunc("/wails/ws", t.handleWebSocket)
	t.server = &http.Server{Handler: mux}
	go func() {
		if serveErr := t.server.Serve(listener); serveErr != nil && serveErr != http.ErrServerClosed && t.logger != nil {
			t.logger.Warn("ws transport server stopped", "error", serveErr)
		}
	}()
	go func() {
		<-ctx.Done()
		_ = t.server.Shutdown(context.Background())
	}()
	if t.logger != nil {
		t.logger.Info("ws transport ready", "url", t.wsURL)
	}
	return nil
}

// JSClient is served by wails as /wails/transport.js. The frontend loads it
// once to learn the runtime WebSocket URL (wails' /wails/custom.js path is
// hard-coded to 404 outside server mode).
func (t *wailsWSTransport) JSClient() []byte {
	return []byte(fmt.Sprintf("window.__wailsWSURL = %q;\n", t.wsURL))
}

func (t *wailsWSTransport) Stop() error {
	if t.server != nil {
		return t.server.Close()
	}
	return nil
}

// Handler serves the HTTP RPC endpoint over the wails asset server. The
// frontend uses it as a fallback when the WebSocket has not connected yet or
// drops. All other paths pass through to the asset server.
func (t *wailsWSTransport) Handler() func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(rw http.ResponseWriter, req *http.Request) {
			if req.URL.Path == "/wails/runtime" {
				t.handleHTTPRPC(rw, req)
				return
			}
			next.ServeHTTP(rw, req)
		})
	}
}

func (t *wailsWSTransport) addClient(client *wailsWSClient) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.clients[client.conn] = client
	if t.logger != nil {
		t.logger.Info("ws transport client connected", "clients", len(t.clients))
	}
}

func (t *wailsWSTransport) removeClient(client *wailsWSClient) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.clients, client.conn)
	if t.logger != nil {
		t.logger.Info("ws transport client disconnected", "clients", len(t.clients))
	}
}

// clientCount returns the number of connected frontends (test helper).
func (t *wailsWSTransport) clientCount() int {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return len(t.clients)
}
