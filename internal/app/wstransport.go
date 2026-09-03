package app

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// ipcClient tracks one frontend IPC connection. All outbound frames
// (RPC responses and events) go through a single writer goroutine so frames are
// delivered to the frontend in the order wails emitted them.
type wailsWSClient struct {
	conn       *websocket.Conn
	writeCh    chan []byte // RPC responses; kept as writeCh for test compatibility.
	eventCh    chan []byte
	done       chan struct{}
	once       sync.Once
	eventDrops atomic.Uint32
	inbound    chan []byte
}

const (
	wsRPCQueueSize     = 64
	wsEventQueueSize   = 256
	wsInboundQueueSize = 128
	wsMaxConcurrentRPC = 8
	wsMaxMessageBytes  = 1 << 20
	wsMaxEventDrops    = 64
	wsEnqueueTimeout   = 100 * time.Millisecond
	wsShutdownTimeout  = 2 * time.Second
)

func (c *wailsWSClient) close() {
	c.once.Do(func() { close(c.done) })
}

func (c *wailsWSClient) enqueueRPC(payload []byte) bool {
	timer := time.NewTimer(wsEnqueueTimeout)
	defer timer.Stop()
	select {
	case c.writeCh <- payload:
		return true
	case <-c.done:
		return false
	case <-timer.C:
		c.close()
		if c.conn != nil {
			_ = c.conn.CloseNow()
		}
		return false
	}
}

func (c *wailsWSClient) enqueueEvent(payload []byte) bool {
	select {
	case c.eventCh <- payload:
		return true
	case <-c.done:
		return false
	default:
		if c.eventDrops.Add(1) >= wsMaxEventDrops {
			c.close()
			if c.conn != nil {
				_ = c.conn.CloseNow()
			}
		}
		return false
	}
}

func (c *wailsWSClient) writeLoop(ctx context.Context) {
	for {
		payload, ok := c.nextPayload(ctx)
		if !ok || !c.writePayload(ctx, payload) {
			return
		}
	}
}

func (c *wailsWSClient) nextPayload(ctx context.Context) ([]byte, bool) {
	select {
	case payload := <-c.writeCh:
		return payload, true
	default:
	}
	select {
	case payload := <-c.writeCh:
		return payload, true
	case payload := <-c.eventCh:
		return payload, true
	case <-c.done:
		return nil, false
	case <-ctx.Done():
		c.close()
		return nil, false
	}
}

func (c *wailsWSClient) writePayload(ctx context.Context, payload []byte) bool {
	if len(payload) == 0 {
		return true
	}
	writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	err := c.conn.Write(writeCtx, websocket.MessageText, payload)
	cancel()
	if err == nil {
		return true
	}
	c.close()
	_ = c.conn.CloseNow()
	return false
}

// runtimeCallFn executes a single runtime call. Production uses wails'
// MessageProcessor; tests inject a fake to cover the transport protocol
// without booting the whole application (which requires a global wails App).
type runtimeCallFn func(ctx context.Context, req *application.RuntimeRequest) (any, error)

// UnifiedIPCTransport replaces wails' default HTTP-fetch RPC bridge with a local
// TCP WebSocket when the frontend connects. The webview's wails:// scheme
// cannot host WebSockets (the asset server rejects upgrades), so the frontend
// connects to 127.0.0.1:random, which WebKitGTK/WebView2/WKWebView natively
// support.
//
// Runtime calls and Wails custom events share this authenticated connection.
// This avoids the previous split between HTTP RPC and ExecJS event delivery.
type UnifiedIPCTransport struct {
	messageProcessor *application.MessageProcessor
	logger           *slog.Logger
	server           *http.Server
	wsURL            string
	token            string
	runtimeCall      runtimeCallFn
	mu               sync.RWMutex
	clients          map[*websocket.Conn]*wailsWSClient
	terminalInput    func(string, string) (int, error)
	stopOnce         sync.Once
	stopErr          error
}

var _ application.Transport = (*UnifiedIPCTransport)(nil)

var _ application.WailsEventListener = (*UnifiedIPCTransport)(nil)

// Keep the historical internal name available to focused transport tests and
// downstream package-internal helpers while the public architecture name is
// UnifiedIPCTransport.
type wailsWSTransport = UnifiedIPCTransport

// NewUnifiedIPCTransport creates the local authenticated IPC transport.
func NewUnifiedIPCTransport(logger *slog.Logger) *UnifiedIPCTransport {
	return &UnifiedIPCTransport{logger: logger, clients: make(map[*websocket.Conn]*wailsWSClient)}
}

// NewWailsWSTransport is retained as a compatibility wrapper for package
// consumers that used the experimental constructor before unified IPC became
// the default transport.
func NewWailsWSTransport(logger *slog.Logger) *UnifiedIPCTransport {
	return NewUnifiedIPCTransport(logger)
}

// SetTerminalInputHandler installs the low-overhead terminal input fast path.
// It remains multiplexed on the same IPC connection as Wails calls/events.
func (t *UnifiedIPCTransport) SetTerminalInputHandler(handler func(string, string) (int, error)) {
	t.mu.Lock()
	t.terminalInput = handler
	t.mu.Unlock()
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
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		_ = listener.Close()
		return fmt.Errorf("generate ws transport token: %w", err)
	}
	t.token = hex.EncodeToString(tokenBytes)
	t.wsURL = fmt.Sprintf("ws://127.0.0.1:%d/wails/ws?token=%s", port, t.token)
	mux := http.NewServeMux()
	mux.HandleFunc("/wails/ws", t.handleWebSocket)
	t.server = &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
	go func() {
		if serveErr := t.server.Serve(listener); serveErr != nil && serveErr != http.ErrServerClosed && t.logger != nil {
			t.logger.Warn("ws transport server stopped", "error", serveErr)
		}
	}()
	go func() {
		<-ctx.Done()
		_ = t.Stop()
	}()
	if t.logger != nil {
		t.logger.Info("ws transport ready", "port", port, "token_prefix", t.token[:8])
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
	t.stopOnce.Do(func() {
		t.mu.RLock()
		clients := make([]*wailsWSClient, 0, len(t.clients))
		for _, client := range t.clients {
			clients = append(clients, client)
		}
		t.mu.RUnlock()
		for _, client := range clients {
			client.close()
			if client.conn != nil {
				_ = client.conn.CloseNow()
			}
		}
		if t.server != nil {
			shutdownCtx, cancel := context.WithTimeout(context.Background(), wsShutdownTimeout)
			t.stopErr = t.server.Shutdown(shutdownCtx)
			cancel()
		}
	})
	return t.stopErr
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
	delete(t.clients, client.conn)
	client.close()
	t.mu.Unlock()
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
