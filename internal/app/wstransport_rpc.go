package app

import (
	"context"
	"encoding/json"
	"io"
	"net/http"

	"github.com/coder/websocket"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type wsRPCRequest struct {
	ID         string          `json:"id"`
	Object     int             `json:"object"`
	Method     int             `json:"method"`
	Args       json.RawMessage `json:"args"`
	WindowName string          `json:"windowName"`
}

func (t *wailsWSTransport) handleWebSocket(rw http.ResponseWriter, req *http.Request) {
	conn, err := websocket.Accept(rw, req, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	client := &wailsWSClient{conn: conn, writeCh: make(chan []byte, 256)}
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
		t.handleRPC(ctx, client, data)
	}
}

func (t *wailsWSTransport) handleRPC(ctx context.Context, client *wailsWSClient, data []byte) {
	var req wsRPCRequest
	if err := json.Unmarshal(data, &req); err != nil || req.ID == "" {
		return
	}
	if t.runtimeCall == nil {
		t.sendRPCError(client, req.ID, "wails runtime not started")
		return
	}
	resp, err := t.runtimeCall(ctx, buildRuntimeRequest(req.Object, req.Method, req.Args, req.WindowName, ""))
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

func (t *wailsWSTransport) sendRPCResponse(client *wailsWSClient, id, kind, data string) {
	payload, err := json.Marshal(map[string]any{"id": id, "ok": true, "type": kind, "data": data})
	if err != nil {
		return
	}
	client.writeCh <- payload
}

func (t *wailsWSTransport) sendRPCError(client *wailsWSClient, id, message string) {
	payload, err := json.Marshal(map[string]any{"id": id, "ok": false, "error": message})
	if err != nil {
		return
	}
	client.writeCh <- payload
}

func (t *wailsWSTransport) handleHTTPRPC(rw http.ResponseWriter, req *http.Request) {
	if t.runtimeCall == nil {
		t.writeHTTPError(rw, http.StatusInternalServerError, "wails runtime not started")
		return
	}
	body, err := io.ReadAll(io.LimitReader(req.Body, 8<<20))
	if err != nil {
		t.writeHTTPError(rw, http.StatusBadRequest, "unable to read request body")
		return
	}
	var parsed struct {
		Object *int            `json:"object"`
		Method *int            `json:"method"`
		Args   json.RawMessage `json:"args"`
	}
	if len(body) > 0 {
		if err := json.Unmarshal(body, &parsed); err != nil {
			t.writeHTTPError(rw, http.StatusBadRequest, "unable to parse request body as JSON")
			return
		}
	}
	if parsed.Object == nil || parsed.Method == nil {
		t.writeHTTPError(rw, http.StatusBadRequest, "missing object or method")
		return
	}
	runtimeReq := buildRuntimeRequest(*parsed.Object, *parsed.Method, parsed.Args,
		req.Header.Get("x-wails-window-name"), req.Header.Get("x-wails-client-id"))
	resp, err := t.runtimeCall(req.Context(), runtimeReq)
	if err != nil {
		t.writeHTTPError(rw, http.StatusUnprocessableEntity, err.Error())
		return
	}
	if text, ok := resp.(string); ok {
		rw.Header().Set("Content-Type", "text/plain")
		rw.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(rw, text)
		return
	}
	rw.Header().Set("Content-Type", "application/json")
	rw.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(rw).Encode(resp); err != nil && t.logger != nil {
		t.logger.Warn("write http rpc response failed", "error", err)
	}
}

func (t *wailsWSTransport) writeHTTPError(rw http.ResponseWriter, status int, message string) {
	rw.Header().Set("Content-Type", "text/plain")
	rw.WriteHeader(status)
	_, _ = io.WriteString(rw, message)
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
