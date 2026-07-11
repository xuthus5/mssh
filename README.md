# MSSH

A cross-platform SSH client built with Go + Wails v3 + React + xterm.js.

## Features

- Tabbed terminal sessions with split view
- Session management (folders, SSH password/key/agent auth)
- Commercial folder management with one configurable default group and safe migration on deletion
- SFTP file transfer with native file dialogs, progress, ETA, and cancellation
- Port forwarding (local/remote/dynamic)
- SSH key generation and management
- Session recording and playback
- Customizable terminal themes
- Quick command macros
- Explicit host-key fingerprint trust and connection cancellation

## Development

### Prerequisites
- Go 1.26+
- Node.js 20+
- Wails v3 CLI

### Setup
```bash
go mod tidy
cd frontend && npm install
```

### Run
```bash
wails3 dev
```

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
wails3 build
```

### Lint
```bash
goimports-reviser -rm-unused -format ./...
golangci-lint run ./...
```
