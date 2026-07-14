# Terminal Macro Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the active SSH terminal visible when the user opens the macro sidebar from the title bar.

**Architecture:** Preserve `activeSurface` as the right-side content selector and use `workspaceTab` as the sidebar category selector. `activateWorkspace('macros')` becomes terminal-aware, while session navigation and non-terminal macro navigation retain their existing behavior.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest, Testing Library.

## Global Constraints

- Only preserve the right side when the active surface is an SSH terminal.
- Clicking sessions must still show the session asset workspace.
- Preserve terminal lifecycle, focus, SFTP, recording, and split-pane state.
- Keep modified code files at 300 lines or fewer.
- Run all repository quality gates before commit and push.

---

### Task 1: Navigation State Semantics

**Files:**
- Modify: `frontend/src/store/appStoreActions.ts`
- Modify: `frontend/src/store/appStore.test.ts`

**Interfaces:**
- Produces: terminal-aware `activateWorkspace(id: WorkspaceID): void`

- [x] **Step 1: Add failing store tests**

Assert that activating macros from an SSH terminal preserves `activeSurface` and changes `workspaceTab`, while activating sessions or activating macros outside a terminal still changes the workspace surface.

- [x] **Step 2: Verify RED**

Run: `npm test -- appStore.test.ts`

Expected: FAIL because macro activation currently always replaces `activeSurface`.

- [x] **Step 3: Implement terminal-aware workspace activation**

Use a Zustand functional update. When `id === 'macros'` and the current surface type is `terminal`, return only `{ workspaceTab: id }`; otherwise return the existing workspace activation state.

- [x] **Step 4: Verify GREEN**

Run: `npm test -- appStore.test.ts`

Expected: PASS.

### Task 2: Titlebar Sidebar Selection

**Files:**
- Modify: `frontend/src/components/layout/WindowTitleBar.tsx`
- Modify: `frontend/src/components/layout/WindowTitleBar.test.tsx`

**Interfaces:**
- Consumes: `workspaceTab` for fixed navigation selection.

- [x] **Step 1: Add failing interaction tests**

Render an active terminal, click macros, and assert the terminal surface remains active while the macro fixed tab becomes selected. Click sessions and assert the session workspace becomes active.

- [x] **Step 2: Verify RED**

Run: `npm test -- WindowTitleBar.test.tsx`

Expected: FAIL because fixed-tab selection currently depends on `activeSurface` and macro activation replaces the terminal.

- [x] **Step 3: Update fixed navigation selection**

Subscribe to `workspaceTab` and derive each fixed button's `aria-pressed` and active styling from that state. Associate the buttons with the Sidebar, and keep dynamic SSH tabs as the only tablist.

- [x] **Step 4: Verify GREEN**

Run: `npm test -- WindowTitleBar.test.tsx appStore.test.ts`

Expected: PASS.

### Task 3: Verification And Delivery

**Files:**
- Modify only files required by verified regressions.

**Interfaces:**
- Consumes: completed Tasks 1-2.
- Produces: tested, built, committed, and pushed code.

- [x] **Step 1: Run frontend tests and coverage**

Run: `cd frontend && npm test && npm run test:coverage`

Expected: all tests and configured coverage thresholds pass.

- [x] **Step 2: Run Go quality gates**

Run `goimports-reviser`, `go test ./...`, `go test -race ./...`, and `golangci-lint run --timeout 5m ./...` using the project Go toolchain.

Expected: all commands exit successfully.

- [x] **Step 3: Run Wails build**

Run: `PATH="$HOME/.govm/go/bin:$PATH" CGO_ENABLED=1 CC='gcc -fuse-ld=bfd' wails3 build`

Expected: frontend and Go application builds succeed.

- [ ] **Step 4: Commit and push**

Review the staged diff, commit using Conventional Commits, and push `main` to its upstream.
