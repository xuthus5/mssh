package app

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"strconv"

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
	client := &wailsWSClient{conn: conn, writeCh: make(chan []byte, 256), done: make(chan struct{})}
	t.addClient(client)
	defer t.removeClient(client)
	ctx, cancel := context.WithCancel(req.Context())
	defer cancel()
	go client.writeLoop(ctx)
	for {
		_, data, readErr := conn.Read(ctx)
		if readErr != nil {
			return
		}
		go t.handleRPC(ctx, client, data)
	}
}

func (t *wailsWSTransport) handleRPC(ctx context.Context, client *wailsWSClient, data []byte) {
	var req wsRPCRequest
	if err := json.Unmarshal(data, &req); err != nil || req.ID == "" {
		return
	}
	if req.Type == "terminal_input" {
		t.handleTerminalInput(client, req)
		return
	}
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
	_ = client.enqueue(payload)
}

func (t *wailsWSTransport) sendRPCError(client *wailsWSClient, id, message string) {
	payload, err := json.Marshal(map[string]any{"id": id, "ok": false, "error": message})
	if err != nil {
		return
	}
	_ = client.enqueue(payload)
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
		if !client.enqueue(payload) && t.logger != nil {
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
