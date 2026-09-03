package app

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"strconv"
	"sync"

	"github.com/coder/websocket"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type wsRPCRequest struct {
	Type       string          `json:"type"`
	ID         string          `json:"id"`
	Object     int             `json:"object"`
	Method     int             `json:"method"`
	Args       json.RawMessage `json:"args"`
	WindowName string          `json:"windowName"`
	ClientID   string          `json:"clientId"`
	TerminalID string          `json:"terminalID"`
	Data       string          `json:"data"`
}

func (t *wailsWSTransport) handleWebSocket(rw http.ResponseWriter, req *http.Request) {
	if subtle.ConstantTimeCompare([]byte(req.URL.Query().Get("token")), []byte(t.token)) != 1 {
		http.Error(rw, "forbidden", http.StatusForbidden)
		return
	}
	conn, err := websocket.Accept(rw, req, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	conn.SetReadLimit(wsMaxMessageBytes)
	client := &wailsWSClient{
		conn:    conn,
		writeCh: make(chan []byte, wsRPCQueueSize),
		eventCh: make(chan []byte, wsEventQueueSize),
		inbound: make(chan []byte, wsInboundQueueSize),
		done:    make(chan struct{}),
	}
	t.addClient(client)
	defer t.removeClient(client)
	ctx, cancel := context.WithCancel(req.Context())
	defer cancel()
	go client.writeLoop(ctx)
	var dispatchWG sync.WaitGroup
	var rpcWG sync.WaitGroup
	dispatchWG.Add(1)
	go t.dispatchInbound(ctx, client, &rpcWG, &dispatchWG)
	t.readInbound(ctx, client)
	cancel()
	client.close()
	_ = conn.CloseNow()
	dispatchWG.Wait()
	rpcWG.Wait()
}

func (t *wailsWSTransport) dispatchInbound(ctx context.Context, client *wailsWSClient, rpcWG, dispatchWG *sync.WaitGroup) {
	defer dispatchWG.Done()
	rpcSlots := make(chan struct{}, wsMaxConcurrentRPC)
	for {
		select {
		case data := <-client.inbound:
			request, ok := decodeWSRPCRequest(data)
			if !ok {
				continue
			}
			if request.Type == "terminal_input" {
				t.handleTerminalInput(client, request)
				continue
			}
			if !acquireRPCSlot(ctx, client, rpcSlots) {
				return
			}
			rpcWG.Add(1)
			go func(request wsRPCRequest) {
				defer rpcWG.Done()
				defer func() { <-rpcSlots }()
				t.handleRPCRequest(ctx, client, request)
			}(request)
		case <-ctx.Done():
			return
		case <-client.done:
			return
		}
	}
}

func decodeWSRPCRequest(data []byte) (wsRPCRequest, bool) {
	var request wsRPCRequest
	if err := json.Unmarshal(data, &request); err != nil || request.ID == "" {
		return wsRPCRequest{}, false
	}
	return request, true
}

func acquireRPCSlot(ctx context.Context, client *wailsWSClient, slots chan struct{}) bool {
	select {
	case slots <- struct{}{}:
		return true
	case <-ctx.Done():
		return false
	case <-client.done:
		return false
	}
}

func (t *wailsWSTransport) readInbound(ctx context.Context, client *wailsWSClient) {
	for {
		_, data, err := client.conn.Read(ctx)
		if err != nil {
			return
		}
		select {
		case client.inbound <- data:
		case <-ctx.Done():
			return
		case <-client.done:
			return
		default:
			client.close()
			_ = client.conn.CloseNow()
			return
		}
	}
}

func (t *wailsWSTransport) handleRPCRequest(ctx context.Context, client *wailsWSClient, req wsRPCRequest) {
	if req.Type != "" && req.Type != "call" {
		return
	}
	if t.runtimeCall == nil {
		t.sendRPCError(client, req.ID, "wails runtime not started")
		return
	}
	resp, err := t.runtimeCall(ctx, buildRuntimeRequest(req.Object, req.Method, req.Args, req.WindowName, req.ClientID))
	if err != nil {
		t.sendRPCError(client, req.ID, err.Error())
		return
	}
	if text, ok := resp.(string); ok {
		t.sendRPCResponse(client, req.ID, "text", text)
		return
	}
	raw, err := json.Marshal(resp)
	if err != nil {
		t.sendRPCError(client, req.ID, err.Error())
		return
	}
	t.sendRPCResponse(client, req.ID, "json", string(raw))
}

func (t *wailsWSTransport) handleTerminalInput(client *wailsWSClient, req wsRPCRequest) {
	t.mu.RLock()
	handler := t.terminalInput
	t.mu.RUnlock()
	if handler == nil {
		t.sendRPCError(client, req.ID, "terminal input handler is not configured")
		return
	}
	n, err := handler(req.TerminalID, req.Data)
	if err != nil {
		t.sendRPCError(client, req.ID, err.Error())
		return
	}
	t.sendRPCResponse(client, req.ID, "json", strconv.Itoa(n))
}

func (t *wailsWSTransport) sendRPCResponse(client *wailsWSClient, id, kind, data string) {
	payload, err := json.Marshal(map[string]any{"id": id, "ok": true, "type": kind, "data": data})
	if err != nil {
		return
	}
	_ = client.enqueueRPC(payload)
}

func (t *wailsWSTransport) sendRPCError(client *wailsWSClient, id, message string) {
	payload, err := json.Marshal(map[string]any{"id": id, "ok": false, "error": message})
	if err != nil {
		return
	}
	_ = client.enqueueRPC(payload)
}

func (t *wailsWSTransport) DispatchWailsEvent(event *application.CustomEvent) {
	if event == nil {
		return
	}
	rawEvent := event.ToJSON()
	if rawEvent == "" {
		return
	}
	payload, err := json.Marshal(struct {
		Type  string          `json:"type"`
		Event json.RawMessage `json:"event"`
	}{Type: "event", Event: json.RawMessage(rawEvent)})
	if err != nil {
		if t.logger != nil {
			t.logger.Warn("marshal wails event failed", "error", err)
		}
		return
	}
	t.mu.RLock()
	clients := make([]*wailsWSClient, 0, len(t.clients))
	for _, client := range t.clients {
		clients = append(clients, client)
	}
	t.mu.RUnlock()
	for _, client := range clients {
		if !client.enqueueEvent(payload) && t.logger != nil {
			t.logger.Debug("drop event for disconnected ws client")
		}
	}
}

// buildRuntimeRequest constructs a wails RuntimeRequest. Args carries raw JSON
// that must be round-tripped through the Args.UnmarshalJSON hook to populate its
// unexported buffer, matching how the default HTTP transport decodes requests.
func buildRuntimeRequest(object, method int, args json.RawMessage, windowName, clientID string) *application.RuntimeRequest {
	payload, err := json.Marshal(map[string]any{
		"object":            object,
		"method":            method,
		"args":              json.RawMessage(args),
		"webviewWindowName": windowName,
		"clientId":          clientID,
	})
	if err != nil {
		return &application.RuntimeRequest{Object: object, Method: method}
	}
	var runtimeReq application.RuntimeRequest
	if err := json.Unmarshal(payload, &runtimeReq); err != nil {
		return &application.RuntimeRequest{Object: object, Method: method}
	}
	return &runtimeReq
}
