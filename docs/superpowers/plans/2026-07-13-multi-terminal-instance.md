# Multi-Terminal Instance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow every session connection to create an independent terminal and let users duplicate an active terminal from its top-tab context menu.

**Architecture:** Keep `useSession.connect` as the single connection workflow and derive each tab identity from the backend `terminalId`. Add a pure helper for instance numbering and title creation, then call the same connection workflow from both session actions and terminal-tab context menus.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest, Testing Library, shadcn/ui ContextMenu, Wails v3 bindings.

## Global Constraints

- Do not change backend SSH, PTY, authentication, database, or persistence contracts.
- A duplicated terminal is a new SSH login and does not clone remote Shell state.
- Use semantic shadcn/ui components and tokens.
- New behavior must retain at least 90% configured frontend coverage.
- Run all repository quality gates before commit and push.

---

### Task 1: Terminal Tab Identity

**Files:**
- Create: `frontend/src/lib/terminalTabs.ts`
- Create: `frontend/src/lib/terminalTabs.test.ts`
- Modify: `frontend/src/store/appStore.ts`

**Interfaces:**
- Produces: `createTerminalTab(options: CreateTerminalTabOptions): Tab`
- Produces: optional `Tab.terminalInstance: number`

- [ ] **Step 1: Write failing helper tests**

Cover the first instance, sequential instances, reuse of a closed middle number, isolation between sessions, ignored playback tabs, and ID generation from `terminalId`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- terminalTabs.test.ts`

Expected: FAIL because `@/lib/terminalTabs` does not exist.

- [ ] **Step 3: Implement the pure helper**

Find the smallest unused positive `terminalInstance` among open terminal tabs with the same `sessionId`, format the title, and return a unique tab using `terminal-${terminalID}`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- terminalTabs.test.ts`

Expected: PASS.

### Task 2: Multi-Instance Connection Flow

**Files:**
- Modify: `frontend/src/hooks/useSession.ts`
- Modify: `frontend/src/hooks/useSession.test.ts`
- Modify: `frontend/src/hooks/useSession.behavior.test.ts`

**Interfaces:**
- Consumes: `createTerminalTab({ sessionID, sessionName, terminalID, tabs })`
- Produces: `connect(sessionId: string): Promise<void>` that always opens a new backend terminal for a valid session.

- [ ] **Step 1: Write failing connection tests**

Connect the same session twice with two backend terminal IDs and assert two tabs, two backend calls, unique IDs, titles `srv` and `srv #2`, and independent connected states. Add a failure assertion proving no tab is created when `TerminalService.Open` rejects.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- useSession.test.ts useSession.behavior.test.ts`

Expected: FAIL because the second connection reuses `terminal-${sessionId}`.

- [ ] **Step 3: Use the helper in `connect`**

After `TerminalService.Open` succeeds, read current tabs from `useAppStore.getState()`, create the terminal tab, set the returned terminal ID connected, and open the unique tab.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `npm test -- useSession.test.ts useSession.behavior.test.ts`

Expected: PASS.

### Task 3: Duplicate Terminal Context Menu

**Files:**
- Modify: `frontend/src/components/layout/DynamicTabStrip.tsx`
- Modify: `frontend/src/components/layout/DynamicTabStrip.test.tsx`

**Interfaces:**
- Consumes: `useSessionWorkspace().connect(sessionId)`
- Produces: a terminal-only context-menu action named `复制终端`

- [ ] **Step 1: Write failing context-menu tests**

Mock `useSessionWorkspace`, right-click a terminal tab, click `复制终端`, and assert `connect('1')`. Right-click a playback tab and assert the action is absent.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- DynamicTabStrip.test.tsx`

Expected: FAIL because the terminal tab has no context menu.

- [ ] **Step 3: Compose the shadcn context menu**

Wrap terminal `DynamicTab` content in `ContextMenu` and `ContextMenuTrigger`, render `ContextMenuContent` with a `Copy` icon and `ContextMenuItem`, and call the shared `connect` function when `sessionId` is available. Render playback tabs without the duplication action.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- DynamicTabStrip.test.tsx`

Expected: PASS.

### Task 4: Per-Instance SFTP State

**Files:**
- Modify: `frontend/src/components/terminal/TerminalLayers.tsx`
- Modify: `frontend/src/App.test.tsx`
- Create: `frontend/src/components/terminal/TerminalLayers.sftp.test.tsx`

**Interfaces:**
- Consumes: terminal `tab.id`, `terminalId`, and saved-session `sessionId`.
- Produces: independently persisted SFTP panel state and unique drop targets for every open terminal instance.

- [ ] **Step 1: Write a failing SFTP isolation test**

Open SFTP on terminal A, switch to terminal B from the same session, verify B does not inherit A's panel, open B's panel, then switch back and verify both instances retain their own state.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- TerminalLayers.sftp.test.tsx`

Expected: FAIL because the existing state is keyed only by shared `sessionId`.

- [ ] **Step 3: Key SFTP state and drop routing by terminal instance**

Store open panel IDs as a `Set<string>` of terminal tab IDs, keep opened panels mounted inside hidden terminal layers, and build each drop target from the backend `terminalId`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- TerminalLayers.sftp.test.tsx App.test.tsx TerminalLayers.test.tsx`

Expected: PASS.

### Task 5: Provider Integration Coverage

**Files:**
- Create: `frontend/src/App.workspace-integration.test.tsx`

**Interfaces:**
- Consumes: the real `SessionWorkspaceProvider`, `WindowTitleBar`, and `DynamicTabStrip` component chain.
- Produces: integration coverage proving title-bar duplication receives the shared `connect` action.

- [ ] **Step 1: Add the component-tree integration test**

Mock only the `useSession` data hook and heavy workspace layers, render the real App provider/title-bar chain, duplicate a terminal tab, and assert `connect(sessionId)`.

- [ ] **Step 2: Run the integration test**

Run: `npm test -- App.workspace-integration.test.tsx`

Expected: PASS only when `WindowTitleBar` is inside `SessionWorkspaceProvider`.

### Task 6: Regression And Delivery Gates

**Files:**
- Modify only files required to fix regressions discovered by verification.

**Interfaces:**
- Consumes: completed Tasks 1-3.
- Produces: verified, committed, and pushed implementation.

- [ ] **Step 1: Run frontend tests and coverage**

Run: `cd frontend && npm test && npm run test:coverage && npm run build`

Expected: all tests pass, configured coverage thresholds pass, and TypeScript/Vite build succeeds.

- [ ] **Step 2: Run Go formatting and tests**

Run the repository-configured `goimports-reviser`, `go test ./...`, and `go test -race ./...` using the project Go toolchain.

Expected: formatting produces no unintended changes and all Go tests pass.

- [ ] **Step 3: Run lint and Wails build**

Run repository-configured `golangci-lint` and `CC='gcc -fuse-ld=bfd' wails3 build`.

Expected: lint and build exit successfully.

- [ ] **Step 4: Review, commit, and push**

Inspect `git diff` and `git status`, commit with Conventional Commits, and push `main` to its configured upstream.
