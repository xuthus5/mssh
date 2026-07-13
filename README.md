# MSSH

A cross-platform SSH client built with Go + Wails v3 + React + xterm.js.

## Features

- Persistent top-level terminal and playback tabs with split view and per-tab recovery
- Linked workspace navigation with a collapsible sidebar
- Session management (folders, SSH password/key/agent auth)
- Commercial folder management with one configurable default group and safe migration on deletion
- SFTP file transfer with native dialogs and a global progress, retry, history, ETA, and cancellation center
- Port forwarding (local/remote/dynamic)
- SSH key generation and management
- Session recording and playback
- Customizable terminal themes
- Searchable system font and size settings for the application interface
- Persisted 50–100% application window opacity with desktop-compositor compatibility guidance
- Quick command macros
- Explicit host-key fingerprint trust and connection cancellation
- About page with GitHub release update checks

## Development

### Prerequisites
- Go 1.26+
- Node.js 20+
- Wails v3 CLI
- Linux: GTK4 and WebKitGTK development packages required by Wails

### Setup
```bash
go mod tidy
cd frontend && npm install
```

### Run
```bash
wails3 task dev
```

Wails requires CGO on Linux. If running the CLI directly, use
`CGO_ENABLED=1 wails3 dev`. An `undefined: pointer` error from Wails indicates
that CGO was disabled in the current shell or persisted Go environment.

### Test
```bash
# Backend (race detection and project coverage gate)
go test -race -coverprofile=coverage.out -covermode=atomic \
  -coverpkg=./internal/...,./pkg/... ./internal/... ./pkg/...
go tool cover -func=coverage.out | tail -1

# Frontend
cd frontend && npx vitest run && npx tsc -b --noEmit
```

### Build
```bash
CGO_ENABLED=1 wails3 build
```

### Lint
```bash
goimports-reviser -rm-unused -format ./...
golangci-lint run ./...
```
