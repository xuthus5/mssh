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

## Output coalescing (enhancement)

- Inactive terminals batch `term.write` via `TerminalOutputCoalescer` (default 32ms / 64KiB).
- Active terminals still pass through immediately; switching active flushes pending batches.
- Data path remains live (no backlog-only-on-resume). Guardian tests: `terminalOutputCoalescer.test.ts`.

## File tree

- `FileTreeView` virtualizes when flattened visible nodes > 80.

## Session tree scroll-into-view

- Keyboard focus target (`aria-activedescendant`) scrolls into view with `block: 'nearest'`.
- Keeps virtualized/long lists usable without changing selection model.

## Macro execute path

- Macros workspace executes against the active connected terminal via `MacroService.Execute`.
- Guardian: `WorkspaceContent.test.tsx` (no terminal / disconnected / success / failure).

## Sampling notes (synthetic)

| Surface | Dataset | Observation method | Expected |
| --- | --- | --- | --- |
| Session tree | 1k visible nodes | VirtualList + unit helpers | O(viewport) DOM |
| File list | 1.2k files | FileListView window | O(viewport) DOM |
| File tree | >80 flat nodes | VirtualList threshold | O(viewport) DOM |
| Command history | 2k rows | fixed-row window | O(viewport) DOM |
| Terminal output | high-rate inactive tab | Coalescer 32ms/64KiB | batched writes; buffer stays live |

Real device profiling (CPU long-task / FPS) remains optional product polish, not a correctness gate.

## Coalescer metrics

- `TerminalOutputCoalescer.getMetrics()` exposes push/pass-through/flush counters for tests and future debug UI.
- Active tabs still pass through immediately (`passThrough*`); inactive tabs accumulate `flushedBatches`.

