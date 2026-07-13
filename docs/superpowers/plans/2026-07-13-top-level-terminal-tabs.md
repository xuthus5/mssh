# Top-Level Terminal Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将会话、宏、SSH 终端和回放统一为窗口顶部一级导航，并用三条杠同步收缩顶部固定菜单与左侧边栏。

**Architecture:** Zustand 使用 `activeSurface` 作为唯一页面激活源，动态终端始终挂载并通过可见性切换。标题栏拆分固定导航与动态标签条，侧边栏尺寸和收缩状态由同一 store 持久化；终端恢复通过幂等生命周期和独立 Error Boundary 隔离故障。

**Tech Stack:** React 19、TypeScript、Zustand、Vitest、Testing Library、shadcn/ui、xterm.js、Wails v3。

## Global Constraints

- 不新增前端或 Go 依赖，不修改数据库、后端 API 和 Wails 绑定。
- 所有新增 UI 使用 shadcn 语义令牌、`rounded-xl`、`border` 和 `shadow-sm` 风格。
- 函数不超过 50 行，代码文件不超过 300 行，新增行为必须有测试看护。
- Welcome 每次启动只显示一次；切换工作区不能关闭 SSH 或卸载终端。
- 最终必须通过前端覆盖率、Go race、`goimports-reviser`、`golangci-lint` 和 `wails3 build`。

## File Structure

- Create `frontend/src/store/tabNavigation.ts`: 一级页面类型、标签关闭回退和导航持久化纯函数。
- Modify `frontend/src/store/appStore.ts`: 统一导航状态和异步标签关闭动作。
- Modify `frontend/src/hooks/useResizablePanel.ts`: 改为消费 store 中的宽度和收缩状态。
- Create `frontend/src/components/layout/DynamicTabStrip.tsx`: 动态标签、关闭确认、滚动和快捷列表。
- Modify `frontend/src/components/layout/WindowTitleBar.tsx`: 三条杠、固定工作区、动态标签和窗口按钮。
- Delete `frontend/src/components/layout/TabBar.tsx`: 移除窗口栏下一级标签条。
- Create `frontend/src/components/layout/WorkspaceContent.tsx`: Welcome、会话资产和宏工作区。
- Create `frontend/src/components/terminal/TerminalLayers.tsx`: 常驻终端/回放层和 SFTP 面板。
- Create `frontend/src/components/terminal/TerminalErrorBoundary.tsx`: 单终端错误隔离与重试。
- Modify `frontend/src/App.tsx`: 组装一级导航、侧边栏和内容层。
- Modify `frontend/src/components/layout/Sidebar.tsx`, `StatusBar.tsx`, `frontend/src/hooks/useSession.ts`: 迁移统一状态选择器。
- Modify `frontend/src/hooks/useTerminal.ts`, `TerminalEmulator.tsx`, `PlaybackTab.tsx`: 可见性恢复和幂等清理。

---

### Task 1: Unified Navigation Store

**Files:**
- Create: `frontend/src/store/tabNavigation.ts`
- Modify: `frontend/src/store/appStore.ts`
- Test: `frontend/src/store/appStore.test.ts`

**Interfaces:**
- Produces: `ActiveSurface`, `WorkspaceID`, `activateWorkspace(id)`, `activateTab(id, focus?)`, `toggleNavigation()`, `setSidebarWidth(width)`, `closeTab(id): Promise<void>`.
- [ ] **Step 1: Write failing store tests**

```ts
it('uses one active surface for workspaces and dynamic tabs', () => {
  const store = useAppStore.getState()
  store.activateWorkspace('sessions')
  expect(useAppStore.getState().activeSurface).toEqual({ type: 'workspace', id: 'sessions' })
  store.openTab({ id: 'terminal-1', title: 'one', type: 'terminal', terminalId: 'term-1' })
  expect(useAppStore.getState().activeSurface).toEqual({ type: 'terminal', id: 'terminal-1' })
})

it('falls back right, left, then sessions when closing the active tab', async () => {
  const store = useAppStore.getState()
  store.openTab({ id: 'a', title: 'A', type: 'playback' })
  store.openTab({ id: 'b', title: 'B', type: 'playback' })
  store.openTab({ id: 'c', title: 'C', type: 'playback' })
  store.activateTab('b')
  await store.closeTab('b')
  expect(useAppStore.getState().activeSurface).toEqual({ type: 'playback', id: 'c' })
})
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `cd frontend && npx vitest run src/store/appStore.test.ts` — Expected: FAIL because `activeSurface`, `activateWorkspace`, and `activateTab` do not exist.

- [ ] **Step 3: Implement navigation types and pure fallback**

```ts
import type { Tab } from '@/store/appStore'

export type WorkspaceID = 'sessions' | 'macros'
export type ActiveSurface =
  | { type: 'workspace'; id: WorkspaceID }
  | { type: 'terminal'; id: string }
  | { type: 'playback'; id: string }

export function surfaceForTab(tab: Tab): ActiveSurface {
  return { type: tab.type, id: tab.id }
}

export function fallbackAfterClose(tabs: Tab[], closingID: string): ActiveSurface {
  const index = tabs.findIndex((tab) => tab.id === closingID)
  const remaining = tabs.filter((tab) => tab.id !== closingID)
  const next = remaining[index] ?? remaining[index - 1]
  return next ? surfaceForTab(next) : { type: 'workspace', id: 'sessions' }
}
```

- [ ] **Step 4: Implement synchronized store actions**

Restrict `Tab.type` to `'terminal' | 'playback'`. Initialize `activeSurface: null`, `workspaceTab: 'sessions'`, persisted `navigationCollapsed/sidebarWidth`, and `focusRequest: { id: '', sequence: 0 }`. `openTab` activates the tab; `activateWorkspace` updates both workspace fields; `activateTab(id, true)` increments focus sequence. Make `closeTab` await `TerminalService.Close`, accept an explicit “terminal not found” response as already closed, then call `removeTabLocal`; add tests for both rejection and already-closed handling.

- [ ] **Step 5: Run tests and commit**

Run: `cd frontend && npx vitest run src/store/appStore.test.ts src/store/eventBridge.test.ts src/hooks/useSession.test.ts` — Expected: PASS.

```bash
git add frontend/src/store/tabNavigation.ts frontend/src/store/appStore.ts frontend/src/store/appStore.test.ts
git commit -m "refactor(store): unify navigation state"
```

### Task 2: Linked Navigation Collapse

**Files:**
- Modify: `frontend/src/hooks/useResizablePanel.ts`
- Modify: `frontend/src/hooks/useResizablePanel.test.tsx`
- Modify: `frontend/src/components/layout/Sidebar.tsx`
- Modify: `frontend/src/components/layout/WindowTitleBar.tsx`
- Modify: `frontend/src/components/layout/WindowTitleBar.test.tsx`

**Interfaces:**
- Consumes: `navigationCollapsed`, `sidebarWidth`, `toggleNavigation`, `setSidebarWidth`, `activateWorkspace`.
- Produces: one hamburger button with `aria-expanded`, and a sidebar without its former midpoint collapse button.
- [ ] **Step 1: Write failing linked-collapse tests**

```ts
it('collapses fixed navigation and the sidebar together', async () => {
  useAppStore.setState({ activeSurface: { type: 'workspace', id: 'sessions' }, navigationCollapsed: false })
  render(<WindowTitleBar />)
  await userEvent.click(screen.getByRole('button', { name: '收起导航' }))
  expect(useAppStore.getState().navigationCollapsed).toBe(true)
  expect(screen.queryByRole('tab', { name: '会话' })).not.toBeInTheDocument()
})
```

Update the resize-hook test to set store width, drag the separator, and assert `sidebarWidth` plus `localStorage['mssh:sidebar-width']`; remove assertions for hook-local `collapsed`.

- [ ] **Step 2: Verify tests fail**

Run: `cd frontend && npx vitest run src/hooks/useResizablePanel.test.tsx src/components/layout/WindowTitleBar.test.tsx` — Expected: FAIL because the hamburger and store-controlled sizing are absent.

- [ ] **Step 3: Refactor resizing and title navigation**

`useResizablePanel` reads `sidebarWidth/navigationCollapsed` from Zustand and writes through store actions. `WindowTitleBar` always renders the hamburger; fixed “会话/宏” tabs render only when expanded. `Sidebar` uses the same state, removes `ChevronLeft/ChevronRight`, and keeps the resize separator available only when expanded.

- [ ] **Step 4: Run tests and commit**

Run: `cd frontend && npx vitest run src/hooks/useResizablePanel.test.tsx src/components/layout/WindowTitleBar.test.tsx` — Expected: PASS.

```bash
git add frontend/src/hooks/useResizablePanel.ts frontend/src/hooks/useResizablePanel.test.tsx frontend/src/components/layout/Sidebar.tsx frontend/src/components/layout/WindowTitleBar.tsx frontend/src/components/layout/WindowTitleBar.test.tsx
git commit -m "feat(navigation): link sidebar collapse"
```

### Task 3: Dynamic Tabs in the Window Bar

**Files:**
- Create: `frontend/src/components/layout/DynamicTabStrip.tsx`
- Create: `frontend/src/components/layout/DynamicTabStrip.test.tsx`
- Modify: `frontend/src/components/layout/WindowTitleBar.tsx`
- Delete: `frontend/src/components/layout/TabBar.tsx`

**Interfaces:**
- Consumes: `tabs`, `activeSurface`, `activateTab`, `closeTab`, connection and recording status.
- Produces: inline dynamic tabs, an overflow dropdown, keyboard navigation, and close confirmation.
- [ ] **Step 1: Write failing dynamic-tab tests**

```ts
it('activates a terminal without closing background tabs', async () => {
  seedTabs()
  render(<DynamicTabStrip />)
  await userEvent.click(screen.getByRole('tab', { name: /生产服务器/ }))
  expect(useAppStore.getState().activeSurface).toEqual({ type: 'terminal', id: 'terminal-1' })
  expect(useAppStore.getState().tabs).toHaveLength(2)
})

it('lists every dynamic tab in the overflow menu', async () => {
  seedTabs()
  render(<DynamicTabStrip />)
  await userEvent.click(screen.getByRole('button', { name: '打开标签列表' }))
  expect(screen.getByRole('menuitem', { name: /回放 #1/ })).toBeInTheDocument()
})
```

- [ ] **Step 2: Verify tests fail**

Run: `cd frontend && npx vitest run src/components/layout/DynamicTabStrip.test.tsx` — Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement and integrate the strip**

Render terminal status dots with `connectionStatusVisual`, playback with a play icon, close buttons with full accessible labels, ArrowLeft/ArrowRight navigation, horizontal scrolling, and a shadcn `DropdownMenu` containing all tabs. Reuse the existing active-connection confirmation; catch `closeTab` errors and show a destructive toast. Insert the strip before the draggable spacer in `WindowTitleBar` and remove the old second-row `TabBar`.

- [ ] **Step 4: Run tests and commit**

Run: `cd frontend && npx vitest run src/components/layout/DynamicTabStrip.test.tsx src/components/layout/WindowTitleBar.test.tsx` — Expected: PASS.

```bash
git add frontend/src/components/layout/DynamicTabStrip.tsx frontend/src/components/layout/DynamicTabStrip.test.tsx frontend/src/components/layout/WindowTitleBar.tsx frontend/src/components/layout/TabBar.tsx
git commit -m "feat(tabs): move terminals to title bar"
```

### Task 4: Persistent Content Layers

**Files:**
- Create: `frontend/src/components/layout/WorkspaceContent.tsx`
- Create: `frontend/src/components/terminal/TerminalLayers.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.test.tsx`
- Modify: `frontend/src/components/layout/StatusBar.tsx`
- Modify: `frontend/src/hooks/useSession.ts`
- Modify: `frontend/src/hooks/useSession.test.ts`

**Interfaces:**
- Consumes: `activeSurface`, `workspaceTab`, dynamic tabs, and focus request sequence.
- Produces: Welcome/workspace layer plus always-mounted dynamic layers.
- [ ] **Step 1: Write failing layer tests**

Mock `TerminalTab` and assert that opening a terminal, activating `workspace/sessions`, and rerendering keeps the terminal node in the document with an inactive marker while the asset workspace is visible. Assert `activeSurface === null` shows Welcome and never returns after `activateWorkspace`.

- [ ] **Step 2: Verify tests fail**

Run: `cd frontend && npx vitest run src/App.test.tsx src/hooks/useSession.test.ts` — Expected: FAIL because current `TabContent` returns early and legacy activation fields remain.

- [ ] **Step 3: Split workspace and terminal layers**

Move Welcome and workspace rendering to `WorkspaceContent`. Move `FilePanelContainer` and tab mapping to `TerminalLayers`; render every terminal and playback inside `absolute inset-0`, using `invisible pointer-events-none` for inactive layers instead of unmounting. Show workspace content whenever `activeSurface` is null or a workspace. Update shortcuts, status bar, and session connection code to use `activeSurface` selectors, then remove `activeTabId`, `sidebarTab`, and `hasEnteredWorkspace` compatibility state.

- [ ] **Step 4: Run tests and commit**

Run: `cd frontend && npx vitest run src/App.test.tsx src/hooks/useSession.test.ts src/store/appStore.test.ts src/store/eventBridge.test.ts` — Expected: PASS.

```bash
git add frontend/src/App.tsx frontend/src/App.test.tsx frontend/src/components/layout/WorkspaceContent.tsx frontend/src/components/terminal/TerminalLayers.tsx frontend/src/components/layout/StatusBar.tsx frontend/src/hooks/useSession.ts frontend/src/hooks/useSession.test.ts frontend/src/store/appStore.ts
git commit -m "refactor(app): preserve dynamic content layers"
```

### Task 5: Terminal Recovery and Fault Isolation

**Files:**
- Create: `frontend/src/components/terminal/TerminalErrorBoundary.tsx`
- Create: `frontend/src/components/terminal/TerminalErrorBoundary.test.tsx`
- Modify: `frontend/src/components/terminal/TerminalLayers.tsx`
- Modify: `frontend/src/components/terminal/TerminalEmulator.tsx`
- Modify: `frontend/src/components/terminal/PlaybackTab.tsx`
- Modify: `frontend/src/components/terminal/PlaybackTab.test.tsx`
- Modify: `frontend/src/hooks/useTerminal.ts`
- Modify: `frontend/src/hooks/useTerminal.test.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes: layer visibility and `focusRequest.sequence`.
- Produces: idempotent xterm cleanup, ordered `fit -> refresh -> focus`, playback refit, and per-tab recovery UI.
- [ ] **Step 1: Write failing lifecycle and boundary tests**

Add a hook test asserting an inactive-to-active transition records `['fit', 'refresh', 'focus']`, a visibility change without a new focus request omits `focus`, and repeated cleanup disposes each resource once. Add a boundary test with a throwing child that displays “终端渲染失败”, supports “重试”, and calls the supplied close callback.

- [ ] **Step 2: Verify tests fail**

Run: `cd frontend && npx vitest run src/hooks/useTerminal.test.tsx src/components/terminal/TerminalErrorBoundary.test.tsx src/components/terminal/PlaybackTab.test.tsx` — Expected: FAIL because focus requests, boundary, and playback visibility recovery are absent.

- [ ] **Step 3: Implement safe activation and cleanup**

Change `useTerminal` to accept `{ active, focusRequest }`, schedule one animation frame after visibility, guard zero-size containers, and call `focus()` only when the request sequence changes. Use a local `disposed` guard so timers, subscriptions, observers, disposables, and terminal instances are each released once. Give `PlaybackTab` an `active` prop and refit/refresh when visible. Wrap each dynamic layer with `TerminalErrorBoundary`, whose retry key remounts only the failed layer.

- [ ] **Step 4: Update documentation, run tests, and commit**

Document top-level tabs and linked navigation collapse in the concise feature list.

Run: `cd frontend && npx vitest run src/hooks/useTerminal.test.tsx src/components/terminal/TerminalErrorBoundary.test.tsx src/components/terminal/PlaybackTab.test.tsx src/App.test.tsx` — Expected: PASS.

```bash
git add frontend/src/components/terminal frontend/src/hooks/useTerminal.ts frontend/src/hooks/useTerminal.test.tsx README.md
git commit -m "fix(terminal): isolate tab lifecycle failures"
```

### Task 6: Integration Verification and Delivery

**Files:**
- Verify all modified files; do not add generated artifacts.

- [ ] **Step 1: Run frontend quality gates**

Run: `cd frontend && npm run test:coverage && npm run build`
Expected: all tests pass, changed navigation/terminal code reaches at least 90% line coverage, TypeScript and Vite build succeed.

- [ ] **Step 2: Run Go formatting, lint, tests, and race**

Run: `export PATH="$HOME/.govm/go/bin:$HOME/go/bin:$PATH"; goimports-reviser -rm-unused -format ./... && golangci-lint run --timeout 5m ./... && go test -race ./...`
Expected: exit code 0 for every command.

- [ ] **Step 3: Run required desktop build**

Run: `export PATH="$HOME/.govm/go/bin:$HOME/go/bin:$PATH"; CGO_ENABLED=1 wails3 build`
Expected: frontend and Go desktop build complete successfully.

- [ ] **Step 4: Clean temporary artifacts and inspect changes**

Run: `rm -f coverage.out && rm -rf frontend/coverage && git status --short && git diff --check`
Expected: no coverage or temporary build files are staged; only intended source, test, and README changes remain.

- [ ] **Step 5: Push verified commits**

Run: `git push`
Expected: current `main` advances on `origin/main` with all five implementation commits.
