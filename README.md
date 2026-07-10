# MSSH

A cross-platform SSH client built with Go + Wails v3 + React + xterm.js.

## Features

- Tabbed terminal sessions with split view
- Session management (folders, SSH password/key/agent auth)
- SFTP file transfer with progress tracking
- Port forwarding (local/remote/dynamic)
- SSH key generation and management
- Session recording and playback
- Customizable terminal themes
- Quick command macros

## Development

### Prerequisites
- Go 1.24+
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
# Backend
go test -race -cover ./...

# Frontend
cd frontend && npm test
```

### Build
```bash
go build ./...
cd frontend && npm run build
```

### Lint
```bash
golangci-lint run ./...
```
