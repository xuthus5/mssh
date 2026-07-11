# MSSH UX Interaction Closure Design

## Goal

Close every UX issue identified in the 2026-07-11 review without placeholders, silent failures, or disconnected frontend/backend state. The implementation must preserve existing product capabilities while making SSH trust decisions, terminal lifecycle, file transfer, recording, tunnelling, forms, shortcuts, accessibility, and feedback behavior observable and testable.

## Scope

This design covers:

- SSH connection attempts, cancellation, retry, and host-key verification.
- Terminal instances, tabs, split panes, focus, recording, closure, and LRU behavior.
- SFTP navigation, native file selection, progress, completion, failure, and cancellation.
- Tunnel listing, creation, start, stop, and state feedback.
- Session, folder, key, theme, sync, and settings forms.
- Recording playback, seek, speed changes, and log operations.
- Loading, empty, failure, destructive confirmation, toast, keyboard, and accessibility behavior.
- Lazy loading of heavy terminal, playback, and SFTP modules.

Out of scope:

- New SSH protocols or authentication methods.
- Remote cloud-sync implementation beyond accurately disabling or reporting currently unsupported behavior.
- A visual redesign unrelated to the reviewed interaction problems.

## Architecture

### Backend task coordination

Long-running operations use explicit task objects owned by their service. Each task has a stable ID, cancellable context, terminal state, and cleanup path. Cancellation must reach the blocking network or file operation rather than only removing an in-memory record.

`SessionService` owns connection attempts. An attempt remains pending while an unknown host key is awaiting a decision. The backend emits a challenge containing an attempt ID, hostname, algorithm, and fingerprint. The frontend calls an explicit decision method. Rejecting, dismissing, or cancelling the attempt closes the pending connection and does not modify `known_hosts`.

`TerminalService` stores both PTY and SSH connection IDs for every terminal. Closing or evicting a terminal closes the PTY, disconnects the associated SSH connection, stops active recording, and emits a terminal-closed event.

`FileService` passes context into copy loops. Upload and download use temporary destination names where needed so cancelled or failed transfers cannot be mistaken for complete files.

### Frontend application state

Zustand becomes the source of truth for:

- Open tabs and active tab.
- Terminal instances and active split pane.
- Connection attempts and host-key challenges.
- Connection and terminal states.
- Recording state per terminal.
- File transfer tasks and their terminal states.
- Tunnel state.

A single application event bridge subscribes to Wails events once and updates the store. Feature hooks initiate commands but do not maintain duplicate task state.

Open terminal tabs remain mounted. Inactive workspaces are hidden rather than destroyed, preserving xterm scrollback, selection, pane focus, and recording state. Permanent closure disposes frontend resources and calls the backend exactly once.

### Native desktop operations

Local upload paths, download destinations, configuration import/export, and key import/export use Wails native dialogs. Browser file handles and plain file names are not passed to Go filesystem APIs.

### UI composition

The implementation uses existing shadcn components and adds missing primitives through the shadcn CLI when required:

- `AlertDialog` for destructive or connection-ending actions.
- `Field`, `FieldGroup`, and field descriptions for forms and validation.
- `Empty`, `Skeleton`, `Alert`, `Spinner`, `Badge`, `Separator`, and accessible toast feedback.
- `ContextMenu` and tab/tree semantics instead of hand-written overlays.

Raw browser `prompt` calls and hand-written modal overlays are removed.

## Interaction Flows

### SSH connection and host-key verification

1. The user starts a connection.
2. A connection dialog shows a cancellable pending state.
3. For a known key, the attempt proceeds normally.
4. For an unknown key, the state changes exclusively to `awaiting-host-key`.
5. Accept continues the same attempt and persists the key.
6. Reject, Escape, window dismissal, or cancel aborts the attempt.
7. Success opens or activates the terminal tab.
8. Failure preserves the session and offers retry and edit actions.

Host-key mismatch is a distinct high-risk state and never uses the first-use confirmation copy.

### Terminal and tab lifecycle

- Creating a terminal registers the xterm instance before toolbar actions become enabled.
- Switching tabs hides inactive workspaces without unmounting them.
- Split panes register independently and update the active-pane ID on focus.
- Copy, paste, clear, macros, resize, and recording target the active pane.
- Closing an active connection requires confirmation when recording or a live PTY exists.
- Closing other tabs applies the same policy per affected tab.
- LRU eviction closes the corresponding tab and informs the user; it never leaves a dead tab visible.

### File transfer

- Native dialogs return absolute local paths.
- Upload destination combines the current remote directory with the selected file name.
- Every task appears in a global transfer center within 500 ms.
- Progress shows bytes, percentage, speed, and ETA.
- Success, failure, cancellation, and retry are explicit terminal states.
- Cancelling stops I/O within one second and prevents a success event.
- Closing the SFTP panel does not hide or cancel active tasks.
- Directory navigation ignores stale responses and exposes retry after failure.

### Tunnels

- The tunnel dialog loads persisted tunnels for the active session.
- Start and stop call the real backend service and show pending state.
- Backend tunnel events update the visible state.
- The entry is disabled with an explanation when no session is active.

### Forms and destructive actions

- Async forms remain open while saving and disable duplicate submission.
- Success closes the form and emits confirmation.
- Failure preserves input and displays an actionable inline error.
- Session, folder, key, recording, remote file, and active-terminal deletion use explicit confirmation.
- Button copy consistently distinguishes `创建会话` from `创建并连接`.

### Playback and recording

- Recording state is stored per terminal outside component-local state.
- Switching tabs does not stop or visually lose an active recording.
- Playback seek reconstructs terminal state to the target timestamp.
- Speed changes reschedule playback immediately.
- Log loading and deletion have separate loading, empty, error, and pending states.

### Keyboard and accessibility

- Session navigation exposes tree/treeitem semantics and arrow-key behavior.
- Tabs expose tablist/tab/tabpanel semantics and roving focus.
- Context menus restore focus to their trigger.
- Icon-only buttons have accessible labels.
- Global shortcuts ignore editable controls and modal contexts unless explicitly applicable.
- Windows/Linux use Control; macOS uses Meta where appropriate.
- Every advertised shortcut has a behavior test.
- Toasts use live regions and keyboard-accessible dismissal.

## Error Handling

No user-triggered failure may be logger-only. Errors are mapped into one of:

- Inline field or form errors for recoverable input/save failures.
- Alerts with retry for loading failures.
- Persistent task errors for transfers and connection attempts.
- Toasts for short-lived confirmations or non-blocking failures.

Errors retain developer detail in logs while presenting actionable, user-oriented copy in the interface.

## Performance

- Independent settings reads and writes execute concurrently when partial ordering is unnecessary.
- Terminal, playback, and SFTP UI modules are loaded with React lazy boundaries.
- Wails event subscriptions are installed once by the application event bridge.
- Rapid directory navigation uses request generation IDs or cancellation to prevent stale responses from replacing current data.

## Testing

### Go

- Host-key challenge acceptance, rejection, dismissal, mismatch, and cancellation.
- Terminal-to-connection mapping and cleanup.
- File transfer cancellation reaching the copy loop.
- Transfer state event ordering and partial-file policy.
- Tunnel start/stop state and failures.
- Native dialog service error and cancellation behavior.

### React

- Terminal registration, persistence across tab switches, active-pane routing, and disposal.
- Connection pending/cancel/host-key/retry flows.
- Transfer event bridge, terminal states, cancellation, and persistence outside the SFTP panel.
- Async form pending, success, failure, and data preservation.
- Search ancestor expansion and result counts.
- Keyboard behavior for tree, tabs, menus, and shortcuts.
- Playback seek and immediate speed changes.
- Recording persistence across tab switches.
- Loading, empty, error, retry, confirmation, and live-region behavior.

### Completion gates

- Go line coverage remains at least 90%.
- `go test -race` passes for backend packages.
- Frontend Vitest suite and TypeScript build pass.
- `goimports-reviser` and `golangci-lint` report no issues.
- `wails3 build` succeeds.
- Temporary build and coverage artifacts are removed.

## Implementation Order

1. Backend connection attempt and host-key decision contract.
2. Terminal connection mapping and lifecycle.
3. Context-aware file transfers and native dialogs.
4. Frontend event bridge and unified application state.
5. Persistent terminal workspaces and active-pane routing.
6. Transfer center and SFTP interaction completion.
7. Real tunnel management.
8. Async forms, confirmations, loading/error states, and accessibility.
9. Playback, recording, shortcuts, and lazy loading.
10. Full regression, coverage, lint, formatting, Wails build, and cleanup.
