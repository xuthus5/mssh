# Titlebar Overflow Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the dynamic-tab list button beside the theme toggle and render it only when the tab strip actually overflows.

**Architecture:** `DynamicTabStrip` measures its scroll container with `ResizeObserver` and reports overflow to `WindowTitleBar`. The existing menu becomes a separately exported component rendered in the right-side controls, while flex sizing reserves the unused middle area for Wails window dragging.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, ResizeObserver, shadcn/ui DropdownMenu.

## Global Constraints

- Preserve existing tab activation, keyboard navigation, close confirmation, and context-menu behavior.
- Use actual DOM overflow, not a tab-count threshold.
- Keep all modified code files at 300 lines or fewer.
- Run frontend coverage and all repository quality gates before commit and push.

---

### Task 1: Overflow Detection

**Files:**
- Modify: `frontend/src/components/layout/DynamicTabStrip.tsx`
- Modify: `frontend/src/components/layout/DynamicTabStrip.test.tsx`

**Interfaces:**
- Produces: `DynamicTabStrip({ onOverflowChange }: { onOverflowChange?: (overflow: boolean) => void })`
- Produces: `DynamicTabOverflowMenu()`

- [ ] **Step 1: Add failing overflow tests**

Mock the tab list `clientWidth`, `scrollWidth`, and `ResizeObserver`; assert overflow changes are reported when dimensions cross the boundary and the strip no longer renders the menu itself.

- [ ] **Step 2: Verify RED**

Run: `npm test -- DynamicTabStrip.test.tsx`

Expected: FAIL because the strip has no overflow callback and always renders the menu.

- [ ] **Step 3: Implement measurement and extract the menu**

Observe the tab list element, compare `scrollWidth` with `clientWidth`, deduplicate callback values, and export the existing dropdown as `DynamicTabOverflowMenu`.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- DynamicTabStrip.test.tsx`

Expected: PASS.

### Task 2: Titlebar Placement And Drag Region

**Files:**
- Modify: `frontend/src/components/layout/WindowTitleBar.tsx`
- Modify: `frontend/src/components/layout/WindowTitleBar.test.tsx`

**Interfaces:**
- Consumes: `DynamicTabStrip.onOverflowChange`
- Consumes: `DynamicTabOverflowMenu`

- [ ] **Step 1: Add failing placement tests**

Assert the menu is absent when tabs fit, appears after overflow, and is ordered after the drag region but before the theme toggle.

- [ ] **Step 2: Verify RED**

Run: `npm test -- WindowTitleBar.test.tsx`

Expected: FAIL because the titlebar does not own overflow state or right-side menu placement.

- [ ] **Step 3: Implement the titlebar layout**

Store the overflow boolean in `WindowTitleBar`, render the menu conditionally before the theme button, make the tab strip content-sized and shrinkable, and give the drag region a stable minimum width.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- WindowTitleBar.test.tsx DynamicTabStrip.test.tsx`

Expected: PASS.

### Task 3: Verification And Delivery

**Files:**
- Modify only files required by verified regressions.

**Interfaces:**
- Consumes: completed Tasks 1-2.
- Produces: tested, built, committed, and pushed code.

- [ ] **Step 1: Run frontend tests and coverage**

Run: `cd frontend && npm test && npm run test:coverage`

Expected: all tests and configured coverage thresholds pass.

- [ ] **Step 2: Run Go quality gates**

Run `goimports-reviser`, `go test ./...`, `go test -race ./...`, and `golangci-lint run --timeout 5m ./...` with the project Go toolchain.

Expected: all commands exit successfully.

- [ ] **Step 3: Run Wails production build**

Run: `PATH="$HOME/.govm/go/bin:$PATH" CGO_ENABLED=1 CC='gcc -fuse-ld=bfd' wails3 build`

Expected: frontend and Go application builds succeed.

- [ ] **Step 4: Commit and push**

Review the staged diff, commit using Conventional Commits, and push `main` to its configured upstream.
