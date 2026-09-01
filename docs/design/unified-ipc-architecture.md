# Unified IPC Architecture

## Decision

MSSH uses one authenticated, loopback-only WebSocket transport for all desktop webview communication:

- Wails generated method calls use `type: call` frames and correlated responses.
- Interactive xterm input uses `type: terminal_input` frames and reaches `TerminalService.Write` directly, bypassing Wails reflection while staying on the same channel.
- Wails custom events use `type: event` frames on the same connection.
- The frontend keeps `Events.On` and generated bindings unchanged; the transport dispatches received events through `window._wails.dispatchWailsEvent`.
- HTTP runtime fallback and Wails `ExecJS` event delivery are not part of the desktop runtime path.

The loopback socket is an adapter around the native webview networking stack. It avoids per-call HTTP connection setup while remaining available on Linux, macOS and Windows, where browser JavaScript cannot open Unix-domain sockets or named pipes directly.

## Competitor Comparison

| Product / pattern | Calls | Events / stream | Main tradeoff |
| --- | --- | --- | --- |
| Wails default desktop runtime | HTTP fetch | native `ExecJS` event bridge | mature compatibility, but two paths and higher call overhead |
| Electron | Chromium IPC / MessagePort | IPC messages and streams | strong primitives, larger runtime footprint |
| VS Code desktop | Electron IPC plus dedicated extension/message channels | multiplexed protocol streams | high throughput, complex host/runtime boundary |
| Termius / native SSH clients | native process or socket channels | native event loop | best latency, not directly reusable from a webview |
| MSSH unified IPC | authenticated loopback WebSocket | same multiplexed message channel | small cross-platform adapter with one protocol |

## Protocol

Control messages are JSON and remain compatible with Wails `RuntimeRequest` semantics:

```json
{"type":"call","id":"...","object":1,"method":2,"args":null,"windowName":"main","clientId":"..."}
{"id":"...","ok":true,"type":"json","data":"{...}"}
{"type":"terminal_input","id":"...","terminalID":"...","data":"ls\\r"}
{"type":"event","event":{"name":"session:state","data":{"...":"..."}}}
```

The transport URL contains a per-process random token. The server binds only to `127.0.0.1`, validates the token using constant-time comparison, and closes all clients during application shutdown.

## Reliability Rules

- Calls issued before connection establishment are bounded by a 15-second timeout.
- Calls already sent when the socket closes are rejected rather than replayed, avoiding duplicate side effects.
- The client reconnects with exponential backoff after an unexpected disconnect.
- A reconnect notification causes mounted terminal panes to re-attach and release any stale output pause state.
- Event delivery uses the same ordered writer queue as RPC responses.
- Terminal output remains lossless through the existing terminal output flow-control and attach/recovery logic; binary terminal frames are a follow-up optimization after protocol metrics confirm JSON encoding is a bottleneck.

## Migration Boundary

Generated Wails bindings and application-level event subscriptions remain stable. Only the transport adapter and bootstrap path change, which keeps service contracts and user workflows intact while allowing protocol evolution behind one boundary.
