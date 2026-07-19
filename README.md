# MSSH

A cross-platform SSH client built with Go + Wails v3 + React + xterm.js.

## Features

- Persistent top-level terminal and playback tabs with multi-instance connections, terminal duplication, restart recovery, and per-tab tool panels
- Recursive terminal splitting supports up to eight independently closable and reconnectable panes with draggable dividers
- Active terminal content search supports plain text or regular expressions, highlighted matches, and previous/next navigation
- Overview workspace for sessions, SSH keys, and tunnels, plus non-disruptive session and macro sidebars
- Encrypted `.msshbackup` backups with GitHub Gist, WebDAV, and AWS S3/S3-compatible synchronization using Argon2id, AES-256-GCM, and conditional writes
- Session management (folders, SSH password/key/agent auth)
- Versioned CSV import and export for sessions, nested folders, asset metadata, and optional explicitly confirmed plaintext passwords
- Governed session assets with environment/project catalogs, multi-tag assignment, advanced filtering, bulk updates, audited migration, and detail panels
- Confirmed multi-session connection and macro execution with per-node results
- Optional local audit log for connections, synchronization, deletion, key access, and batch actions
- Unified asynchronous loading, retry, empty-state, duplicate-submit, and stale-response handling
- Commercial folder management with one configurable default group and safe reassignment on deletion
- SFTP file transfer with native dialogs, hidden-file filtering, OSC 7 terminal-directory following, explicit manual directory synchronization, list/tree views, and a global progress, retry, history, ETA, and cancellation center
- Port forwarding (local/remote/dynamic)
- SSH key generation and management
- Session recording and playback
- 24 curated offline terminal themes with optional Dark/Light following or a fixed Profile, `.itermcolors` import, live preview, and built-in style reset
- Searchable system font and size settings for the application interface
- Terminal behavior settings support right-click menus or paste and optional copy-on-select
- System tray controls support showing, hiding, and exiting, with a configurable close-button action
- Persisted 50–100% application window opacity with desktop-compositor compatibility guidance
- Lazy-loaded native settings window with a frameless application title bar and live cross-window preview
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

### Data format
Database format-version mismatches trigger a destructive reset. Sync imports and exports require `format_version: 3`.

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

# Isolated local sshd + tmux + SFTP integration
task test:e2e

# Performance budgets and allocation benchmarks
task benchmark
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
