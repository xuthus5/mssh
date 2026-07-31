# MSSH — Secure Shell Client & Session Manager

A modern, cross-platform SSH client built with [Go](https://go.dev) + [Wails v3](https://wails.io) + [React](https://react.dev) + [xterm.js](https://xtermjs.org).

[![CI](https://github.com/xuthus5/mssh/actions/workflows/ci.yml/badge.svg)](https://github.com/xuthus5/mssh/actions/workflows/ci.yml)
[![Release](https://github.com/xuthus5/mssh/actions/workflows/release.yml/badge.svg)](https://github.com/xuthus5/mssh/actions/workflows/release.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> [中文](README_zh-CN.md)

---

## Install

### Linux

**Debian / Ubuntu (deb)**

```bash
# Download the latest .deb from releases
sudo dpkg -i mssh_*.deb
sudo apt-get install -f   # install dependencies
```

**Fedora / RHEL (rpm)**

```bash
# Download the latest .rpm from releases
sudo rpm -ivh mssh-*.rpm
```

**Arch Linux (AUR)**

```bash
yay -S mssh
# or via PKGBUILD from releases
```

**Flatpak**

[![Flathub](https://img.shields.io/badge/Flathub-io.github.xuthus5.mssh-blue?logo=flathub)](https://flathub.org/apps/io.github.xuthus5.mssh)

```bash
flatpak install flathub io.github.xuthus5.mssh
```

**AppImage**

```bash
# Download the .AppImage from releases
chmod +x mssh-*.AppImage
./mssh-*.AppImage
```

### macOS

```bash
# Download the universal .app zip from releases
unzip mssh-macos-*.zip
open mssh.app
```

### Windows

```bash
# Download the NSIS installer from releases
mssh-setup-*.exe
```

> All release artifacts include SHA-256 checksums, CycloneDX SBOM, provenance attestations, and Sigstore signatures.

---

## Features

### Terminal & SSH

- Persistent top-level tabs with multi-instance connections, tab duplication, and restart recovery
- Recursive terminal splitting — up to 8 independently reconnectable panes with draggable dividers
- Active terminal search with plain text or regex, highlighted matches, and prev/next navigation
- Overview workspace for sessions, SSH keys, tunnels, macros, and serial ports

### File Transfer (SFTP)

- Native file dialogs with hidden-file filtering, list/tree views
- OSC 7 directory following — auto-syncs SFTP panel to remote working directory
- Global transfer center with progress, ETA, retry, history, and cancellation

### Security & Vault

- Application master key encryption (Argon2id + AES-256-GCM, min 12 chars)
- Encrypted `.msshbackup` backups with encrypted export/import
- System keychain integration (Linux secret-service, Windows Credential Manager, macOS Keychain)
- Host key verification with explicit fingerprint trust and change detection
- Optional audit logging for connections, sync, key access, and batch operations

### Cloud Sync

| Provider     | Features                     |
|-------------|------------------------------|
| GitHub Gist | Encrypted session backup sync |
| WebDAV      | HTTPS directory sync          |
| AWS S3      | Path-style access, MinIO/Ceph |

### AI Agent

- Native AI tasks using configured OpenAI-compatible providers
- Local CLI tasks via MSSH MCP bridge (Claude Code / OpenCode)
- Per-step approval for mutations, hard-blocked destructive commands
- Persistent task state — manual resume after application restart
- Conversation history with search context

### Theming & Appearance

- 24 curated offline terminal themes (GitHub Dark/Light, Dracula, Nord, TokyoNight, Catppuccin, etc.)
- Import `.itermcolors` files
- Dark/Light/Fixed mode assignments
- System font and size configuration

### Serial Port

- Full serial terminal: 300–4,000,000 baud, data/parity/stop bits flow control (XON-XOFF, RTS-CTS, DSR-DTR)
- DTR/RTS/Break control, local echo, exclusive device lock

### Local Shell

- Configurable shell path, arguments, working directory, login mode
- Session recording support

### Session Assets & Automation

- Environments (dev/staging/production), projects, multi-tag assignment
- CSV import/export supporting MSSH, PuTTY, SecureCRT, and MobaXterm formats
- Batch operations: bulk updates, deletion, multi-session macro execution
- Macro templates with per-node results
- Port forwarding (local/remote/dynamic)
- SSH key generation and management
- Session recording and playback

### Keyboard Shortcuts

| Shortcut           | Action                |
|--------------------|-----------------------|
| `Ctrl+N`           | New SSH session       |
| `Ctrl+Shift+N`     | New local terminal    |
| `Ctrl+W`           | Close current tab     |
| `Ctrl+F`           | Quick search sessions |
| `Ctrl+Shift+C`     | Copy selection        |
| `Ctrl+Shift+V`     | Paste clipboard       |
| `Ctrl+Shift+L`     | Clear terminal        |

All shortcuts are customizable with conflict detection.

### System Integration

- System tray (show/hide/exit)
- Configurable close-button behavior (minimize to tray or exit)
- Daily application logs in `~/.mssh/logs` with configurable retention

---

## Development

### Prerequisites

- Go 1.26+
- Node.js 20+
- [Wails v3 CLI](https://github.com/wailsapp/wails) (`go install github.com/wailsapp/wails/v3/cmd/wails3@latest`)
- **Linux**: GTK4 and WebKitGTK 6.0 development packages

### Quick Start

```bash
# Install frontend dependencies
cd frontend && npm ci && cd ..

# Run in development mode
wails3 task dev

# Build for production
wails3 task build
```

### CI Gate (required before commit/push)

```bash
wails3 task ci
```

This runs: lint → backend tests (race + ≥90% coverage) → frontend tests + bundle check → production build.

### Individual Tasks

```bash
wails3 task lint               # golangci-lint (v2.12.2)
wails3 task fmt                # goimports-reviser format
wails3 task test               # backend race + coverage
wails3 task test:frontend      # vitest + source limits + bundle budget
wails3 task test:e2e           # SSH/tmux/SFTP/serial integration
wails3 task benchmark          # performance budgets
wails3 task package            # current OS packages
wails3 task package:linux:amd64 # Linux: deb + rpm + AppImage + Flatpak
```

### Packaging

Git tags matching `v*` trigger the release pipeline, producing:

| Platform  | Architectures | Artifacts                          |
|-----------|---------------|------------------------------------|
| Linux     | amd64, arm64  | binary, deb, rpm, AppImage, Flatpak |
| Windows   | amd64, arm64  | exe + NSIS installer                |
| macOS     | universal     | `.app` zip                          |

---

## Tech Stack

| Layer      | Technology                                      |
|------------|-------------------------------------------------|
| Frontend   | React 19, TypeScript, Vite 6, Tailwind CSS 4, xterm.js |
| Backend    | Go 1.26, Wails v3 (GTK4 + WebKitGTK 6.0)       |
| Database   | SQLite (via modernc.org/sqlite)                 |
| SSH        | golang.org/x/crypto, pkg/sftp                   |
| Crypto     | Argon2id, AES-256-GCM                           |
| keychain   | go-keyring (Linux/Windows/macOS)                |
| Serial     | go.bug.st/serial                                |
| Cloud SDK  | AWS SDK v2                                      |

---

## License

[MIT](LICENSE)
