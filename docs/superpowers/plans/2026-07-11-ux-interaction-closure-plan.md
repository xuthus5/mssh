# MSSH UX Interaction Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fully close every UX interaction issue in `docs/superpowers/specs/2026-07-11-ux-interaction-closure-design.md` with tested Go/Wails contracts and persistent, accessible React state.

**Architecture:** Backend services own cancellable connection, terminal, transfer, and tunnel tasks. A single React event bridge maps Wails events into Zustand, while terminal workspaces stay mounted and all async forms expose pending/success/error states. Native desktop dialogs replace browser-only file paths.

**Tech Stack:** Go 1.25+, Wails v3, React 19, TypeScript, Zustand, xterm.js, shadcn/ui base-nova, Vitest, Testify.

## Global Constraints

- Preserve current user-visible capabilities unless the approved design explicitly changes them.
- Go coverage must remain at least 90%.
- Every new method and interaction requires success, error, boundary, and cancellation tests.
- Handle every returned error; no defer inside loops.
- Created directories use `0700`; files use `0600` unless executable.
- Use semantic shadcn tokens and existing components before custom markup.
- Do not commit or push unless the user explicitly requests it.
- Final gates: `go test -race`, frontend Vitest, TypeScript, `goimports-reviser`, `golangci-lint`, and `wails3 build`.

---

### Task 1: Cancellable SSH connection and host-key decisions

**Files:**
- Modify: `internal/service/session.go`
- Modify: `internal/ssh/client.go`
- Modify: `pkg/event/event.go`
- Modify: `internal/service/session_test.go`
- Modify: `internal/ssh/client_test.go`

**Interfaces:**
- Produce: `SessionService.BeginConnect(ctx context.Context, sessionID int64) (attemptID string, error)`
- Produce: `SessionService.DecideHostKey(attemptID string, accept bool) error`
- Produce: `SessionService.CancelConnect(attemptID string) error`
- Produce events carrying `attempt_id`, hostname, algorithm, fingerprint, and state.

- [ ] Write failing tests proving an unknown key blocks until accepted, rejection avoids `known_hosts`, cancellation terminates the attempt, and mismatch never enters first-use flow.
- [ ] Run `go test ./internal/service ./internal/ssh -run 'HostKey|ConnectAttempt'` and confirm the new tests fail.
- [ ] Add a mutex-protected connection-attempt registry containing context cancellation and a buffered host-key decision channel.
- [ ] Change the SSH verifier callback to wait on the decision channel or context cancellation before appending `known_hosts`.
- [ ] Emit mutually exclusive connection states and remove unconditional acceptance.
- [ ] Re-run the focused tests and confirm all pass under `-race`.

### Task 2: Terminal-to-connection lifecycle and recording cleanup

**Files:**
- Modify: `internal/service/terminal.go`
- Modify: `internal/service/log.go`
- Modify: `internal/app/app.go`
- Modify: `internal/service/terminal_test.go`
- Modify: `internal/service/log_test.go`

**Interfaces:**
- Produce: terminal records containing `PTY`, `connectionID`, and last-used time.
- Produce: idempotent `TerminalService.Close(terminalID string) error` that closes PTY, recording, and the matching SSH connection.

- [ ] Add failing tests for correct connection-ID cleanup, idempotent close, LRU close events, and recording shutdown.
- [ ] Run focused service tests and verify failure.
- [ ] Replace parallel `ptys` and `lastUsed` maps with one terminal-entry map.
- [ ] Store `connID` returned by `SessionService.Connect` and use it during every cleanup path.
- [ ] Register a recording cleanup callback without introducing package cycles.
- [ ] Run focused tests with `-race` and verify connection counts return to zero.

### Task 3: Context-aware transfers and native path dialogs

**Files:**
- Modify: `internal/service/file.go`
- Modify: `internal/ssh/sftp.go`
- Create: `internal/service/dialog.go`
- Modify: `internal/app/app.go`
- Modify: `main.go`
- Modify: `internal/service/file_test.go`
- Modify: `internal/ssh/sftp_test.go`
- Create: `internal/service/dialog_test.go`

**Interfaces:**
- Produce: `UploadFileContext(ctx context.Context, ...) error`
- Produce: `DownloadFileContext(ctx context.Context, ...) error`
- Produce: `DialogService.OpenFile`, `DialogService.SaveFile`, and `DialogService.SelectDirectory` returning absolute paths.
- Produce: transfer events with `status` equal to `running`, `completed`, `failed`, or `cancelled`.

- [ ] Add failing tests showing cancellation stops copy, no completed event follows cancellation, and partial files follow the documented policy.
- [ ] Run focused file and SFTP tests and verify failure.
- [ ] Implement context-aware copy loops with periodic cancellation checks and idempotent task cleanup.
- [ ] Use `.partial` local downloads and temporary remote upload names followed by rename on success.
- [ ] Wrap Wails application dialogs in an injectable service and test cancellation/error paths with a fake provider.
- [ ] Run focused tests under `-race`.

### Task 4: Unified frontend event bridge and Zustand state

**Files:**
- Create: `frontend/src/store/eventBridge.ts`
- Modify: `frontend/src/store/appStore.ts`
- Modify: `frontend/src/store/connectDialog.ts`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/store/appStore.test.ts`
- Create: `frontend/src/store/eventBridge.test.ts`

**Interfaces:**
- Produce: one `startEventBridge(): () => void` subscription owner.
- Produce store slices for connection attempts, terminal panes, recording states, transfers, and tunnels.
- Produce actions `acceptHostKey`, `rejectHostKey`, `cancelConnection`, `setActivePane`, and transfer terminal-state updates.

- [ ] Add failing tests for every Wails event mapping and subscription cleanup.
- [ ] Run the two store test files and confirm failure.
- [ ] Add normalized task/state types and remove duplicate local transfer/connection state.
- [ ] Install the bridge once from `main.tsx`, with one unsubscribe per event.
- [ ] Implement host-key decision and connection cancellation commands through generated Wails bindings.
- [ ] Re-run store tests and TypeScript diagnostics.

### Task 5: Persistent terminal workspaces, split focus, and safe closure

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/hooks/useTerminal.ts`
- Modify: `frontend/src/components/terminal/TerminalEmulator.tsx`
- Modify: `frontend/src/components/terminal/TerminalTab.tsx`
- Modify: `frontend/src/components/terminal/TerminalSplit.tsx`
- Modify: `frontend/src/components/terminal/TerminalToolbar.tsx`
- Modify: `frontend/src/components/layout/TabBar.tsx`
- Create: `frontend/src/components/terminal/TerminalWorkspace.test.tsx`

**Interfaces:**
- Consume: terminal-pane and recording slices from Task 4.
- Produce: mounted workspaces hidden with `hidden`/layout state, active-pane routing, and a guarded close request.

- [ ] Add failing tests for terminal registration, tab-switch persistence, active split-pane routing, recording persistence, and confirmed closure.
- [ ] Run focused terminal component tests and verify failure.
- [ ] Register/dispose xterm instances in `useTerminal`; remove the misleading welcome text written after connection.
- [ ] Render all open terminal workspaces and hide inactive ones without unmounting.
- [ ] Track focus per pane and route copy, paste, clear, macros, resize, and recording to that pane.
- [ ] Replace handwritten tab/menu interactions with accessible Tabs and ContextMenu composition plus AlertDialog close confirmation.
- [ ] Re-run focused tests and TypeScript.

### Task 6: Global transfer center and complete SFTP interactions

**Files:**
- Modify: `frontend/src/hooks/useFileTransfer.ts`
- Modify: `frontend/src/components/file/FilePanel.tsx`
- Modify: `frontend/src/components/file/TransferProgress.tsx`
- Modify: `frontend/src/components/layout/StatusBar.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/hooks/useFileTransfer.test.ts`
- Create: `frontend/src/components/file/FilePanel.test.tsx`

**Interfaces:**
- Consume: global transfer slice and native dialog service.
- Produce: selectable rows with download, rename, delete, refresh, and retry actions.

- [ ] Add failing tests for absolute upload/download paths, remote target composition, stale directory responses, transfer visibility after panel close, real cancellation, and destructive confirmation.
- [ ] Run focused file tests and verify failure.
- [ ] Remove component-local transfer state and subscribe solely through the event bridge.
- [ ] Add request-generation protection for directory navigation and explicit loading/error/retry states.
- [ ] Add ContextMenu/keyboard actions and AlertDialog deletion confirmation.
- [ ] Render global progress with bytes, percent, speed, ETA, cancel, retry, and terminal states.
- [ ] Re-run focused tests and TypeScript.

### Task 7: Real tunnel management and async form state

**Files:**
- Modify: `frontend/src/components/session/TunnelDialog.tsx`
- Modify: `frontend/src/components/layout/StatusBar.tsx`
- Modify: `frontend/src/hooks/useSession.ts`
- Modify: `frontend/src/components/session/SessionDialog.tsx`
- Modify: `frontend/src/components/layout/Sidebar.tsx`
- Modify: `frontend/src/components/settings/SettingsDialog.tsx`
- Modify: `frontend/src/components/settings/KeyManager.tsx`
- Modify: `frontend/src/components/settings/SyncPanel.tsx`
- Modify: `frontend/src/hooks/useSettings.ts`
- Add focused tests beside the modified hooks/components.

**Interfaces:**
- Consume: tunnel slice and native dialogs from Tasks 3-4.
- Produce: Promise-returning form actions with explicit pending/error results.

- [ ] Add failing tests for tunnel list/start/stop, disabled no-session state, save-pending behavior, preserved input on error, and successful close.
- [ ] Run focused session/settings tests and verify failure.
- [ ] Wire tunnel actions to `TunnelService` and event state; remove logger-only handlers and the fake CPU gauge.
- [ ] Make CRUD/save actions return success or throw; dialogs await them and close only on success.
- [ ] Replace browser prompts and custom form markup with native dialogs and shadcn Field/AlertDialog composition.
- [ ] Parallelize independent settings reads/writes and show success/failure feedback.
- [ ] Re-run focused tests and TypeScript.

### Task 8: Search, loading states, playback, shortcuts, and accessibility

**Files:**
- Modify: `frontend/src/components/session/SessionTree.tsx`
- Modify: `frontend/src/components/layout/Sidebar.tsx`
- Modify: `frontend/src/components/terminal/PlaybackTab.tsx`
- Modify: `frontend/src/components/terminal/SessionLog.tsx`
- Modify: `frontend/src/components/ui/toast.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/settings/ThemeEditor.tsx`
- Add focused tests beside each component.

**Interfaces:**
- Produce: ancestor-preserving search results, real playback seek, context-sensitive platform shortcuts, and live-region feedback.

- [ ] Add failing tests for search ancestor expansion/count, loading-vs-empty-vs-error, seek reconstruction, immediate speed change, platform shortcuts, editable-control exclusions, and toast live regions.
- [ ] Run focused tests and verify failure.
- [ ] Implement tree keyboard semantics and reveal matching branches while searching.
- [ ] Rebuild playback state to an arbitrary timestamp and reschedule timers on speed changes.
- [ ] Add retryable log errors, pending recording controls, and confirmation before deleting recordings.
- [ ] Centralize shortcut definitions, implement advertised `Ctrl/Cmd+N`, and restore terminal focus after toolbar actions.
- [ ] Replace raw status colors and hand-built empty/loading surfaces with semantic shadcn components.
- [ ] Re-run focused tests and TypeScript.

### Task 9: Lazy loading, integration tests, documentation, and final gates

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/layout/Sidebar.tsx`
- Modify: `README.md`
- Modify or create integration tests under `frontend/src` and `internal/service`.

**Interfaces:**
- Produce: React lazy boundaries for terminal, playback, SFTP, and settings surfaces.

- [ ] Add tests proving lazy fallback behavior and complete cross-layer event flows.
- [ ] Use `React.lazy` and `Suspense` for heavy feature surfaces without unmounting already-open terminals.
- [ ] Update README with native-dialog, host-key trust, transfer cancellation, and e2e test instructions.
- [ ] Run `goimports-reviser -rm-unused -format ./...`.
- [ ] Run `golangci-lint run ./...` and fix all issues.
- [ ] Run `go test -race -coverprofile=coverage.out -covermode=atomic -coverpkg=./internal/...,./pkg/... ./internal/... ./pkg/...` and verify total coverage is at least 90%.
- [ ] Run `cd frontend && npx vitest run && npx tsc -b --noEmit && npm run build`.
- [ ] Run `wails3 build`.
- [ ] Remove `coverage.out`, generated binaries, and temporary fixtures.
- [ ] Review `git diff --check`, changed-file scope, and every EARS item against the implementation.
