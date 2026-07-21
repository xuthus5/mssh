# Frontend Performance Notes (P1)

## Virtualization
- Session tree: `VirtualList` + `buildVisibleSessionTreeNodes` (FE-PERF-001)
- Remote file list: `FileListView` virtual window (FE-PERF-002)
- Command history: fixed-row virtual window (FE-PERF-003)

### Sampling method
- Dataset: synthetic 1,000 sessions / 1,200 files / 2,000 history rows in unit helpers
- Tooling: Vitest pure helpers (`computeVirtualWindow`, tree flatten) + component render smoke
- Expectation: only O(viewport + overscan) nodes mounted; no full-list DOM

## Inactive terminal soft-throttle (FE-PERF-004)
- Keep `terminal:output` → `term.write` path (no backlog on resume)
- Inactive: `cursorBlink=false` + blur; Active: restore blink + existing fit/resize recovery (`useTerminalActivation`)

## Status bar (FE-PERF-006/007)
- Clock and SystemInfo isolated into child components with own store/visibility subscriptions
- SystemInfo polling stops when tab hidden or terminal not connected

## Bundle
- Terminal/SFTP/Playback remain lazy via `TerminalLayers` dynamic import (FE-PERF-010)
