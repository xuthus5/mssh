# Session Quick Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global `Ctrl+F` / `Command+F` session search dialog that connects the selected session with double-click or `Enter`.

**Architecture:** A focused `SessionQuickSearchDialog` owns filtering and list navigation while a small workspace-aware host supplies sessions, folders, and the existing `connect` callback. `App.tsx` remains the single global keyboard listener and dispatches an application event to open the dialog, including when xterm's hidden textarea has focus.

**Tech Stack:** React 19, TypeScript 5.9, shadcn/ui dialog and input primitives, Tailwind CSS v4 tokens, Vitest, Testing Library.

## Global Constraints

- Reuse `workspace.connect(session.id)`; do not add backend APIs or duplicate connection state.
- Do not intercept `Ctrl+F` / `Command+F` inside ordinary form controls or content-editable elements.
- Do intercept the shortcut inside xterm's hidden textarea.
- Keep production functions at 50 lines or fewer and production files at 300 lines or fewer.
- Use semantic shadcn/ui tokens and the existing `rounded-xl`, `border`, and `shadow-sm` visual language.
- Add automated coverage for filtering, keyboard navigation, double-click, shortcut routing, and empty states.

---

### Task 1: Session Search Dialog

**Files:**
- Create: `frontend/src/components/session/SessionQuickSearchDialog.tsx`
- Create: `frontend/src/components/session/SessionQuickSearchDialog.test.tsx`

**Interfaces:**
- Consumes: `Session[]` and `Folder[]` from `@/hooks/useSession`.
- Produces: `SessionQuickSearchDialog({ open, onOpenChange, sessions, folders, onConnect })`.
- Produces: a controlled dialog that calls `onConnect(session.id)` exactly once after closing.

- [x] **Step 1: Write failing filtering and presentation tests**

Create fixtures containing grouped and ungrouped sessions. Assert that the dialog filters case-insensitively by `name`, `host`, `username`, and folder name, and renders `username@host:port` plus “未分组” where appropriate.

```tsx
render(<SessionQuickSearchDialog open onOpenChange={onOpenChange} sessions={sessions} folders={folders} onConnect={onConnect} />)
await user.type(screen.getByRole('searchbox', { name: '搜索会话' }), 'production')
expect(screen.getByRole('option', { name: /Production API/ })).toBeInTheDocument()
expect(screen.queryByRole('option', { name: /Development/ })).not.toBeInTheDocument()
```

- [x] **Step 2: Run tests and verify RED**

Run: `npm --prefix frontend test -- --run src/components/session/SessionQuickSearchDialog.test.tsx`

Expected: FAIL because `SessionQuickSearchDialog.tsx` does not exist.

- [x] **Step 3: Implement filtering and commercial dialog layout**

Implement normalized search text from session name, host, username, and folder name. Compose existing `Dialog`, `Input`, and `ScrollArea`; use `Search`, `Server`, `Folder`, and `CornerDownLeft` icons; render loading-independent empty messages from the supplied data.

```ts
function sessionSearchText(session: Session, folderName: string) {
  return [session.name, session.host, session.username, folderName].join('\n').toLocaleLowerCase()
}

function filterSessions(sessions: Session[], folders: Folder[], query: string) {
  const names = new Map(folders.map((folder) => [folder.id, folder.name]))
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return sessions
  return sessions.filter((session) => sessionSearchText(session, names.get(session.folderId ?? '') ?? '').includes(normalizedQuery))
}
```

- [x] **Step 4: Write failing keyboard and activation tests**

Assert first-item selection, cyclic `ArrowUp` / `ArrowDown`, selection reset after filtering, `Enter` activation, double-click activation, and no activation when results are empty.

```tsx
fireEvent.keyDown(screen.getByRole('searchbox', { name: '搜索会话' }), { key: 'ArrowDown' })
fireEvent.keyDown(screen.getByRole('searchbox', { name: '搜索会话' }), { key: 'Enter' })
expect(onOpenChange).toHaveBeenCalledWith(false)
expect(onConnect).toHaveBeenCalledWith('session-2')
```

- [x] **Step 5: Implement keyboard selection and activation**

Keep `selectedIndex` local, reset it to zero when `open` or the normalized query changes, cycle within result bounds, and route both keyboard and double-click through one `activateSession` callback.

```ts
const activateSession = (session: Session | undefined) => {
  if (!session) return
  onOpenChange(false)
  onConnect(session.id)
}
```

- [x] **Step 6: Run component tests and verify GREEN**

Run: `npm --prefix frontend test -- --run src/components/session/SessionQuickSearchDialog.test.tsx`

Expected: all dialog tests pass.

---

### Task 2: Global Shortcut and Workspace Integration

**Files:**
- Create: `frontend/src/components/session/SessionQuickSearchHost.tsx`
- Create: `frontend/src/components/session/SessionQuickSearchHost.test.tsx`
- Create: `frontend/src/lib/sessionQuickSearch.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.test.tsx`

**Interfaces:**
- Consumes: `useSessionWorkspace()` returning `sessions`, `folders`, and `connect`.
- Consumes: `mssh:open-session-search` window event dispatched by `App.tsx`.
- Produces: `SessionQuickSearchHost` mounted inside `SessionWorkspaceProvider`.

- [x] **Step 1: Write failing shortcut routing tests**

Add tests proving `Ctrl+F` and `Command+F` prevent default and dispatch `mssh:open-session-search` from `document.body` and an `.xterm-helper-textarea`, while an ordinary input does not dispatch and does not prevent default.

```tsx
const openSearch = vi.fn()
window.addEventListener('mssh:open-session-search', openSearch)
const terminalInput = document.createElement('textarea')
terminalInput.className = 'xterm-helper-textarea'
document.body.append(terminalInput)
expect(fireEvent.keyDown(terminalInput, { key: 'f', ctrlKey: true })).toBe(false)
expect(openSearch).toHaveBeenCalledOnce()
```

- [x] **Step 2: Run shortcut tests and verify RED**

Run: `npm --prefix frontend test -- --run src/App.test.tsx`

Expected: FAIL because `Ctrl+F` is not routed and the search host is not mounted.

- [x] **Step 3: Implement target classification and shortcut event**

Extract a small predicate that identifies ordinary editable targets but excludes xterm's helper textarea. Handle unshifted `f` before returning for ordinary shortcuts, dispatch the application event, and call `preventDefault()`.

```ts
function isOrdinaryEditable(target: HTMLElement | null) {
  if (!target?.matches('input, textarea, select, [contenteditable="true"]')) return false
  return !target.classList.contains('xterm-helper-textarea')
}
```

- [x] **Step 4: Write failing host integration tests**

Mock `useSessionWorkspace`, dispatch `mssh:open-session-search`, verify the dialog opens, and activate a result with `Enter` to prove the existing `connect` callback receives the selected session ID.

```tsx
render(<SessionQuickSearchHost />)
act(() => window.dispatchEvent(new CustomEvent('mssh:open-session-search')))
expect(screen.getByRole('dialog', { name: '快速连接会话' })).toBeInTheDocument()
fireEvent.keyDown(screen.getByRole('searchbox', { name: '搜索会话' }), { key: 'Enter' })
expect(connect).toHaveBeenCalledWith('session-1')
```

- [x] **Step 5: Implement and mount the host**

Subscribe to `mssh:open-session-search` in `useEffect`, store only the controlled `open` state, render `SessionQuickSearchDialog`, and mount the host beside `ConnectDialog` within `SessionWorkspaceProvider`.

- [x] **Step 6: Run focused integration tests and verify GREEN**

Run: `npm --prefix frontend test -- --run src/App.test.tsx src/components/session/SessionQuickSearchHost.test.tsx src/components/session/SessionQuickSearchDialog.test.tsx`

Expected: all focused tests pass.

---

### Task 3: Quality Gates and Delivery

**Files:**
- Modify if necessary: `README.md`
- Modify: `docs/superpowers/plans/2026-07-15-session-quick-search.md` to mark completed checkboxes.

**Interfaces:**
- Consumes: completed frontend behavior from Tasks 1 and 2.
- Produces: verified, formatted, committed, and pushed feature delivery.

- [x] **Step 1: Run frontend formatting and lint checks**

Run the repository-configured frontend checks. If no dedicated frontend lint script exists, run `npm --prefix frontend run build` and `git diff --check` without adding a new toolchain.

- [x] **Step 2: Run full frontend tests with coverage**

Run: `npm --prefix frontend run test:coverage`

Expected: all tests pass and line coverage remains at least 90%.

- [x] **Step 3: Run Go quality gates**

Run: `PATH="$HOME/.govm/go/bin:$PATH" goimports-reviser -rm-unused -set-alias -format ./...`

Run: `PATH="$HOME/.govm/go/bin:$PATH" golangci-lint run`

Expected: both commands exit successfully; no unrelated files are modified.

- [x] **Step 4: Build the desktop application**

Run: `PATH="$HOME/.govm/go/bin:$PATH" CGO_ENABLED=1 wails3 build`

Expected: build exits successfully.

- [x] **Step 5: Clean temporary artifacts and verify the diff**

Remove `frontend/coverage`, `frontend/dist`, and generated build binaries created by validation. Run `git status --short`, `git diff --check`, and inspect the complete diff.

- [x] **Step 6: Commit and push**

```bash
git add frontend/src/App.tsx frontend/src/App.test.tsx \
  frontend/src/components/session/SessionQuickSearchDialog.tsx \
  frontend/src/components/session/SessionQuickSearchDialog.test.tsx \
  frontend/src/components/session/SessionQuickSearchHost.tsx \
  frontend/src/components/session/SessionQuickSearchHost.test.tsx \
  docs/superpowers/plans/2026-07-15-session-quick-search.md
git commit -m "feat(session): add quick search"
git push origin main
```

Expected: local `main` and `origin/main` reference the same commit and the worktree is clean.
