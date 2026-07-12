# Session Asset Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the startup sidebar-first experience with a one-time welcome page and a full session asset workspace containing recent connections, folders, and all nodes.

**Architecture:** Keep the existing Wails session service and constraints as the source of truth. Add persisted connection recency to sessions, expose it through bindings, split the oversized React sidebar into a compact navigation tree and a right-side asset center, and use a process-local `hasEnteredWorkspace` flag to dismiss welcome permanently until restart.

**Tech Stack:** Go 1.26, SQLite, Wails v3, React 19, TypeScript, Zustand, Vitest, shadcn/ui, Tailwind CSS v4.

## Global Constraints

- Use `$HOME/.govm/go/bin` for Go tooling and keep `CGO_ENABLED=1` for Wails builds.
- Preserve existing folder deletion constraints and backend transaction semantics.
- Use parameterized SQL and explicit error handling; no `defer` inside loops.
- Keep new or changed production functions covered by focused tests and maintain repository coverage at or above 90%.
- Use semantic shadcn tokens and existing components; do not add a duplicate folder-management business path.
- Run `goimports-reviser`, `golangci-lint`, Go race tests, frontend tests/build, and `wails3 build` before delivery.

---

### Task 1: Persist Connection Recency

**Files:**
- Modify: `internal/model/session.go`
- Modify: `internal/store/db.go`
- Modify: `internal/store/session.go`
- Modify: `internal/service/session.go`
- Modify: `internal/model/input.go` only if generated DTO conversion requires it
- Test: `internal/store/db_test.go`, `internal/store/session_test.go`, `internal/service/session_test.go`
- Regenerate: `frontend/bindings/github.com/xuthus5/mssh/internal/model/models.ts`

**Interfaces:**
- Add `LastConnectedAt *time.Time` and `ConnectionCount int` to `model.Session`.
- Add `SessionService.ListRecentSessions(limit int) ([]model.Session, error)`.
- Add `store.ListRecentSessions(db *sql.DB, limit int) ([]model.Session, error)`.
- Add `store.MarkSessionConnected(db *sql.DB, id int64) error`.

- [ ] Add failing schema tests asserting `last_connected_at` and `connection_count` exist and old rows default to null/zero.
- [ ] Add failing store tests for successful recency updates, count increments, descending ordering, limit enforcement, and exclusion of null timestamps.
- [ ] Add a failing service test proving a successful SSH connection marks recency without changing connection failure behavior.
- [ ] Add `ensureSessionRecencySchema` to `store.Migrate` using SQLite table inspection and `ALTER TABLE` only when columns are absent.
- [ ] Extend all session SELECT/scan/update conversion paths with the new fields.
- [ ] Call `MarkSessionConnected` only after `ssh.ConnectWithVerifier` returns successfully; log metadata failures without returning a connection failure.
- [ ] Implement the limit-clamped recent query and service wrapper.
- [ ] Run `export PATH="$HOME/.govm/go/bin:$PATH"; go test -race ./internal/store ./internal/service ./internal/app`.
- [ ] Run `wails3 generate bindings -ts -names -d frontend/bindings .` and verify the new fields are present.

### Task 2: Add Workspace Entry State

**Files:**
- Modify: `frontend/src/store/appStore.ts`
- Modify: `frontend/src/components/layout/WindowTitleBar.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/hooks/useSession.ts`
- Test: `frontend/src/store/appStore.test.ts`, `frontend/src/components/layout/WindowTitleBar.test.tsx`, `frontend/src/App.test.tsx` if present or create it

**Interfaces:**
- Add `hasEnteredWorkspace: boolean` and `enterWorkspace(): void` to `AppState`.
- Keep `SidebarTab = 'sessions' | 'macros'`; selecting either calls `enterWorkspace` before changing the selected workspace.
- `useSession.connect` calls `enterWorkspace` before opening a terminal.

- [ ] Add failing store tests for initial false state and one-way transition to true.
- [ ] Add failing title-bar tests proving Sessions and Macros navigation dismisses welcome.
- [ ] Add failing app-shell tests proving welcome renders only while no workspace has been entered and never returns after closing tabs.
- [ ] Implement the one-way process-local state and wire title-bar navigation.
- [ ] Update `TabContent` and shell layout so the welcome page hides Sidebar and TabBar until workspace entry, while terminal tabs still overlay the selected workspace after entry.
- [ ] Run the focused frontend tests.

### Task 3: Split Session UI and Build Asset Center

**Files:**
- Create: `frontend/src/components/session/SessionWorkspace.tsx`
- Create: `frontend/src/components/session/CompactSessionTree.tsx`
- Create: `frontend/src/components/session/SessionAssetCenter.tsx`
- Create: `frontend/src/components/session/RecentSessionsView.tsx`
- Create: `frontend/src/components/session/FolderAssetsView.tsx`
- Create: `frontend/src/components/session/SessionAssetsView.tsx`
- Modify: `frontend/src/components/layout/Sidebar.tsx` or reduce it to workspace composition
- Modify: `frontend/src/hooks/useSession.ts`
- Test: matching `*.test.tsx` files for each new view and workspace

**Interfaces:**
- `SessionWorkspace` receives the existing session state/actions and renders compact tree plus asset center.
- `SessionAssetCenter` owns `activeAssetTab: 'recent' | 'folders' | 'nodes'`, selected-folder filter, breadcrumb, and Create menu.
- `useSession` exposes `listRecentSessions`, `renameFolder`, `setDefaultFolder`, `deleteFolder`, and existing session mutations with stable callbacks.

- [ ] Add failing tests for the three asset tabs, create menu commands, recent ten-row rendering, folder node counts, all-node filtering, breadcrumb reset, and loading/error states.
- [ ] Add failing tests for compact-tree folder selection, keyboard access, explicit connect action, and double-click connection.
- [ ] Implement the compact tree by extracting navigation behavior from `SessionTree`; remove tree-level edit/delete controls.
- [ ] Implement the asset center with shadcn `Tabs`, `Table`, `DropdownMenu`, `Breadcrumb`, `Badge`, `Empty`, `AlertDialog`, and existing `Card`/`Button` components.
- [ ] Implement recent cards/table with `last_connected_at` and `connection_count` display.
- [ ] Implement folder rows with rename, set-default, delete confirmation, node counts, and protected disabled states.
- [ ] Implement all-node rows with search, folder filter, connect/edit/move/delete actions, and breadcrumb reset.
- [ ] Ensure both Create menu commands open the existing `SessionDialog` and folder dialog.
- [ ] Run all new session workspace tests.

### Task 4: Remove Settings Folder Management and Integrate Shell

**Files:**
- Modify: `frontend/src/components/settings/SettingsDialog.tsx`
- Modify: `frontend/src/components/settings/SettingsDialog.test.tsx`
- Modify: `frontend/src/components/settings/FolderManager.tsx` only if it becomes unused and can be removed safely
- Modify: `frontend/src/components/layout/Sidebar.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/hooks/useSession.ts`
- Test: `frontend/src/components/session/SessionWorkspace.test.tsx`, `frontend/src/components/settings/SettingsDialog.test.tsx`

**Interfaces:**
- Settings no longer accepts folder-management props and no longer renders a folders category.
- The app shell renders `SessionWorkspace` as the selected sessions workspace and the existing macro panel as the selected macros workspace.

- [ ] Add failing Settings tests proving the folder category and FolderManager are absent.
- [ ] Move shared session/folder dialogs to `SessionWorkspace` without changing Wails method signatures.
- [ ] Wire the title-bar workspace selection, welcome-once state, compact tree, and asset center into the app shell.
- [ ] Preserve terminal, playback, settings, macro, SFTP, keyboard shortcut, resizing, and collapse behavior.
- [ ] Remove dead folder-management props/imports and update README only if user-facing workflow text references Settings folders.
- [ ] Run frontend full test suite and production build.

### Task 5: Delivery Verification

**Files:**
- Modify: `docs/superpowers/plans/2026-07-12-session-asset-workspace-plan.md`

- [ ] Run `goimports-reviser -project-name github.com/xuthus5/mssh -rm-unused -set-alias -format ./...`.
- [ ] Run `golangci-lint run` and `go test -race ./...`.
- [ ] Run repository Go coverage and require total coverage at least 90%.
- [ ] Run `npm test --prefix frontend` and `npm run build --prefix frontend`.
- [ ] Run `wails3 build` with the configured `$HOME/.govm` Go toolchain.
- [ ] Remove coverage files and build binaries.
- [ ] Mark every plan item complete, inspect `git diff --check`, commit with `feat(session): add asset workspace`, push `main`, and verify `HEAD == origin/main` with a clean status.
