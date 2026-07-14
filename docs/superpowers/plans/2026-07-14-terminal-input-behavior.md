# Terminal Input Behavior Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add database-backed terminal mouse behavior settings for right-click menu or paste and optional copy-on-select, with immediate application to open SSH and playback terminals.

**Architecture:** Persist the two values through the existing generic `SettingService`, normalize them in a dedicated Zustand terminal behavior store, and let terminal lifecycles read that store directly. Shared clipboard and debounced selection helpers keep SSH and playback behavior consistent, while a focused shadcn interaction surface owns the live-terminal context menu.

**Tech Stack:** React 19, TypeScript, Zustand, xterm.js, shadcn/ui Base Nova, Vitest, Testing Library, Go 1.26, Wails v3, SQLite.

## Global Constraints

- `terminal.right_click_action` defaults to `menu` and only accepts `menu` or `paste`.
- `terminal.copy_on_select` defaults to `false` and must be stored as a boolean setting.
- Right-click behavior applies only to interactive SSH terminals.
- Copy-on-select applies to interactive SSH and playback terminals.
- Saving General Settings updates existing terminals without reconnecting or rebuilding xterm instances.
- Clipboard failures from explicit actions show an error toast and log; automatic copy failures only log.
- All subscriptions, timers, and DOM listeners must be disposed exactly once.
- Use existing shadcn semantic tokens and `rounded-xl border border-border bg-card shadow-sm` styling.
- Keep functions at 50 lines or fewer, source files at 300 lines or fewer, nesting at three levels or fewer, and cyclomatic complexity at ten or fewer.
- Do not add a dependency, database migration, Go API, or generated Wails binding.
- Frontend and Go line coverage must remain at or above 90%.
- Run `goimports-reviser`, `golangci-lint`, race tests, frontend coverage, and `wails3 build` before the final push.

---

### Task 1: Persist And Publish Terminal Behavior Settings

**Files:**
- Create: `frontend/src/store/terminalBehaviorStore.ts`
- Create: `frontend/src/store/terminalBehaviorStore.test.ts`
- Modify: `frontend/src/hooks/useSettings.ts:23-108`
- Modify: `frontend/src/hooks/useSettings.test.ts:37-105`

**Interfaces:**
- Produces: `TerminalRightClickAction = 'menu' | 'paste'`.
- Produces: `TerminalBehaviorSettings{rightClickAction, copyOnSelect}`.
- Produces: `normalizeTerminalRightClickAction(value)` and `normalizeCopyOnSelect(value)`.
- Produces: `useTerminalBehaviorStore` with `setSettings(settings)`.
- Extends: `GeneralSettings` with `rightClickAction` and `copyOnSelect`.

- [ ] **Step 1: Add failing store normalization tests**

Create `frontend/src/store/terminalBehaviorStore.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_TERMINAL_BEHAVIOR,
  normalizeCopyOnSelect,
  normalizeTerminalRightClickAction,
  useTerminalBehaviorStore,
} from '@/store/terminalBehaviorStore'

describe('terminal behavior store', () => {
  beforeEach(() => useTerminalBehaviorStore.setState(DEFAULT_TERMINAL_BEHAVIOR))

  it.each([
    ['menu', 'menu'],
    ['paste', 'paste'],
    ['invalid', 'menu'],
    [null, 'menu'],
  ])('normalizes right-click action %o', (value, expected) => {
    expect(normalizeTerminalRightClickAction(value)).toBe(expected)
  })

  it.each([[true, true], [false, false], ['true', false], [1, false]])('normalizes copy-on-select %o', (value, expected) => {
    expect(normalizeCopyOnSelect(value)).toBe(expected)
  })

  it('publishes complete settings atomically', () => {
    useTerminalBehaviorStore.getState().setSettings({ rightClickAction: 'paste', copyOnSelect: true })
    expect(useTerminalBehaviorStore.getState()).toMatchObject({ rightClickAction: 'paste', copyOnSelect: true })
  })
})
```

- [ ] **Step 2: Extend settings hook tests for defaults, loading, and saving**

Update `frontend/src/hooks/useSettings.test.ts` so the default test asserts:

```ts
expect(result.current.general.rightClickAction).toBe('menu')
expect(result.current.general.copyOnSelect).toBe(false)
```

Add persisted values before rendering:

```ts
_settings['terminal.right_click_action'] = '"paste"'
_settings['terminal.copy_on_select'] = 'true'
```

Then assert both `result.current.general` and `useTerminalBehaviorStore.getState()` contain `paste` and `true`. Extend the save test input with:

```ts
rightClickAction: 'paste',
copyOnSelect: true,
```

and assert:

```ts
expect(writtenSettings).toContainEqual(expect.objectContaining({ key: 'terminal.right_click_action', value: '"paste"' }))
expect(writtenSettings).toContainEqual(expect.objectContaining({ key: 'terminal.copy_on_select', value: 'true' }))
expect(useTerminalBehaviorStore.getState()).toMatchObject({ rightClickAction: 'paste', copyOnSelect: true })
```

Add this save-failure test:

```ts
it('does not publish terminal behavior when persistence fails', async () => {
  useTerminalBehaviorStore.getState().setSettings({ rightClickAction: 'menu', copyOnSelect: false })
  __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.SetMany', async () => { throw new Error('db failed') })
  const { result } = renderHook(() => useSettings())
  await act(async () => {})

  let saveError: unknown
  await act(async () => {
    try {
      await result.current.saveGeneral({ ...result.current.general, rightClickAction: 'paste', copyOnSelect: true })
    } catch (error) {
      saveError = error
    }
  })
  expect(saveError).toEqual(expect.objectContaining({ message: 'db failed' }))
  expect(useTerminalBehaviorStore.getState()).toMatchObject({ rightClickAction: 'menu', copyOnSelect: false })
})
```

- [ ] **Step 3: Run focused tests to verify RED**

Run:

```bash
cd frontend
npm test -- src/store/terminalBehaviorStore.test.ts src/hooks/useSettings.test.ts
```

Expected: FAIL because the behavior store and General Settings fields do not exist.

- [ ] **Step 4: Implement the behavior store**

Create `frontend/src/store/terminalBehaviorStore.ts`:

```ts
import { create } from 'zustand'

export type TerminalRightClickAction = 'menu' | 'paste'

export interface TerminalBehaviorSettings {
  rightClickAction: TerminalRightClickAction
  copyOnSelect: boolean
}

interface TerminalBehaviorState extends TerminalBehaviorSettings {
  setSettings: (settings: TerminalBehaviorSettings) => void
}

export const DEFAULT_TERMINAL_BEHAVIOR: TerminalBehaviorSettings = {
  rightClickAction: 'menu',
  copyOnSelect: false,
}

export function normalizeTerminalRightClickAction(value: unknown): TerminalRightClickAction {
  return value === 'paste' ? 'paste' : 'menu'
}

export function normalizeCopyOnSelect(value: unknown): boolean {
  return value === true
}

export const useTerminalBehaviorStore = create<TerminalBehaviorState>((set) => ({
  ...DEFAULT_TERMINAL_BEHAVIOR,
  setSettings: (settings) => set(settings),
}))
```

- [ ] **Step 5: Load and save behavior through General Settings**

Extend `GeneralSettings` in `frontend/src/hooks/useSettings.ts`:

```ts
rightClickAction: TerminalRightClickAction
copyOnSelect: boolean
```

Add both keys to `SettingService.GetMany`, normalize them into `loaded`, then publish after applying font and opacity:

```ts
const behavior = {
  rightClickAction: normalizeTerminalRightClickAction(settingValue(settings, 'terminal.right_click_action', 'menu')),
  copyOnSelect: normalizeCopyOnSelect(settingValue(settings, 'terminal.copy_on_select', false)),
}
const loaded = {
  maxPoolSize: settingValue(settings, 'terminal.max_pool_size', 10),
  defaultKeepAlive: settingValue(settings, 'terminal.default_keep_alive', 60),
  defaultTermType: settingValue(settings, 'terminal.default_term_type', 'xterm-256color'),
  uiFontFamily,
  uiFontFallbackFamily: normalizeUIFontFallbackFamily(settingValue(settings, 'appearance.ui_font_fallback_family', DEFAULT_UI_FONT_FALLBACK_FAMILY), uiFontFamily),
  uiFontSize: clampUIFontSize(settingValue(settings, 'appearance.ui_font_size', DEFAULT_UI_FONT_SIZE)),
  windowOpacity: clampWindowOpacity(settingValue(settings, 'appearance.window_opacity', DEFAULT_WINDOW_OPACITY)),
  ...behavior,
}
useTerminalBehaviorStore.getState().setSettings(behavior)
```

Normalize the save input, add the settings entries, and publish only after `SetMany` and `TerminalService.SetMaxSize` succeed:

```ts
const behavior = {
  rightClickAction: normalizeTerminalRightClickAction(settings.rightClickAction),
  copyOnSelect: normalizeCopyOnSelect(settings.copyOnSelect),
}
const normalized = { ...settings, ...behavior, uiFontFamily, uiFontFallbackFamily, uiFontSize, windowOpacity }
// SettingService.SetMany includes both terminal behavior keys.
useTerminalBehaviorStore.getState().setSettings(behavior)
```

- [ ] **Step 6: Run focused tests to verify GREEN**

Run:

```bash
cd frontend
npm test -- src/store/terminalBehaviorStore.test.ts src/hooks/useSettings.test.ts
```

Expected: both test files PASS.

- [ ] **Step 7: Commit the persistence boundary**

```bash
git add frontend/src/store/terminalBehaviorStore.ts frontend/src/store/terminalBehaviorStore.test.ts frontend/src/hooks/useSettings.ts frontend/src/hooks/useSettings.test.ts
git commit -m "feat(settings): persist terminal behavior"
```

### Task 2: Add The General Settings Behavior Card

**Files:**
- Create: `frontend/src/components/settings/TerminalBehaviorSettings.tsx`
- Create: `frontend/src/components/settings/TerminalBehaviorSettings.test.tsx`
- Modify: `frontend/src/components/settings/SettingsDialog.tsx:94-230`
- Modify: `frontend/src/components/settings/SettingsDialog.test.tsx:6-120`

**Interfaces:**
- Consumes: `TerminalBehaviorSettings` and `TerminalRightClickAction` from Task 1.
- Produces: `TerminalBehaviorSettingsSection` with controlled right-click select and copy-on-select switch.
- Extends: General Settings form submission with both behavior values.

- [ ] **Step 1: Add failing behavior section tests**

Create `frontend/src/components/settings/TerminalBehaviorSettings.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TerminalBehaviorSettingsSection } from '@/components/settings/TerminalBehaviorSettings'

it('shows labels and emits controlled behavior changes', async () => {
  const onRightClickActionChange = vi.fn()
  const onCopyOnSelectChange = vi.fn()
  render(<TerminalBehaviorSettingsSection rightClickAction="menu" copyOnSelect={false} onRightClickActionChange={onRightClickActionChange} onCopyOnSelectChange={onCopyOnSelectChange} />)

  expect(screen.getByText('行为')).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: '鼠标右键行为' })).toHaveValue('显示菜单')
  await userEvent.click(screen.getByRole('combobox', { name: '鼠标右键行为' }))
  await userEvent.click(screen.getByRole('option', { name: '粘贴' }))
  await userEvent.click(screen.getByRole('switch', { name: '选择即复制' }))

  expect(onRightClickActionChange).toHaveBeenCalledWith('paste')
  expect(onCopyOnSelectChange).toHaveBeenCalledWith(true)
})
```

Extend `SettingsDialog.test.tsx` test data with `rightClickAction: 'menu'` and `copyOnSelect: false`, change both controls, save, and assert `onSaveGeneral` receives `paste` and `true`.

- [ ] **Step 2: Run focused tests to verify RED**

```bash
cd frontend
npm test -- src/components/settings/TerminalBehaviorSettings.test.tsx src/components/settings/SettingsDialog.test.tsx
```

Expected: FAIL because the behavior section is missing.

- [ ] **Step 3: Implement the shadcn behavior section**

Create `frontend/src/components/settings/TerminalBehaviorSettings.tsx` with:

```tsx
const RIGHT_CLICK_OPTIONS = [
  { value: 'menu', label: '显示菜单' },
  { value: 'paste', label: '粘贴' },
] as const

export function TerminalBehaviorSettingsSection(props: Props) {
  return <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
    <div className="mb-3">
      <h3 className="text-sm font-medium text-foreground">行为</h3>
      <p className="mt-1 text-xs text-muted-foreground">控制终端中的鼠标和剪贴板交互。</p>
    </div>
    <div className="flex flex-col gap-3">
      <Field orientation="horizontal">
        <FieldContent><FieldLabel>鼠标右键行为</FieldLabel><FieldDescription>选择显示操作菜单或直接粘贴剪贴板内容。</FieldDescription></FieldContent>
        <LabeledSelect ariaLabel="鼠标右键行为" value={props.rightClickAction} options={RIGHT_CLICK_OPTIONS} onValueChange={(value) => props.onRightClickActionChange(normalizeTerminalRightClickAction(value))} className="w-40" />
      </Field>
      <Field orientation="horizontal">
        <FieldContent><FieldLabel htmlFor="terminal-copy-on-select">选择即复制</FieldLabel><FieldDescription>选中文本后自动写入系统剪贴板。</FieldDescription></FieldContent>
        <Switch id="terminal-copy-on-select" checked={props.copyOnSelect} onCheckedChange={props.onCopyOnSelectChange} />
      </Field>
    </div>
  </section>
}
```

- [ ] **Step 4: Wire the section into SettingsDialog**

Add local state initialized from `general`, refresh it in the existing effect, include it in `handleSaveGeneral`, and render:

```tsx
<TerminalBehaviorSettingsSection
  rightClickAction={rightClickAction}
  copyOnSelect={copyOnSelect}
  onRightClickActionChange={setRightClickAction}
  onCopyOnSelectChange={setCopyOnSelect}
/>
```

Place the card after the terminal defaults and before the interface font card. Keep `SettingsDialog.tsx` below 300 lines.

- [ ] **Step 5: Run focused tests to verify GREEN**

```bash
cd frontend
npm test -- src/components/settings/TerminalBehaviorSettings.test.tsx src/components/settings/SettingsDialog.test.tsx
```

Expected: both test files PASS.

- [ ] **Step 6: Commit the settings UI**

```bash
git add frontend/src/components/settings/TerminalBehaviorSettings.tsx frontend/src/components/settings/TerminalBehaviorSettings.test.tsx frontend/src/components/settings/SettingsDialog.tsx frontend/src/components/settings/SettingsDialog.test.tsx
git commit -m "feat(settings): add terminal behavior controls"
```

### Task 3: Build Shared Clipboard And Selection Runtime

**Files:**
- Create: `frontend/src/lib/terminalInteractions.ts`
- Create: `frontend/src/lib/terminalInteractions.test.ts`
- Create: `frontend/src/components/terminal/terminalBehaviorRuntime.ts`
- Create: `frontend/src/components/terminal/terminalBehaviorRuntime.test.ts`

**Interfaces:**
- Produces: `copyTerminalSelection`, `pasteClipboardIntoTerminal`, and `selectAllTerminal`.
- Produces: `createCopyOnSelectController(term, options)` returning `{setEnabled, dispose}`.
- Produces: `installTerminalCopyOnSelect(term, label)` returning an idempotent cleanup function.

- [ ] **Step 1: Add failing clipboard helper tests**

Add tests with the following assertions:

```ts
const terminal = { getSelection: vi.fn(() => 'selected'), paste: vi.fn(), selectAll: vi.fn(), focus: vi.fn() }
const clipboard = { writeText: vi.fn(async () => {}), readText: vi.fn(async () => 'payload') }
expect(await copyTerminalSelection(terminal as never, clipboard)).toBe(true)
await pasteClipboardIntoTerminal(terminal as never, clipboard)
selectAllTerminal(terminal as never)
expect(clipboard.writeText).toHaveBeenCalledWith('selected')
expect(terminal.paste).toHaveBeenCalledWith('payload')
expect(terminal.selectAll).toHaveBeenCalledOnce()
expect(terminal.focus).toHaveBeenCalledTimes(3)
```

Add an empty-selection and rejection case:

```ts
terminal.getSelection.mockReturnValue('')
expect(await copyTerminalSelection(terminal as never, clipboard)).toBe(false)
expect(clipboard.writeText).not.toHaveBeenCalled()

clipboard.readText.mockRejectedValueOnce(new Error('clipboard denied'))
await expect(pasteClipboardIntoTerminal(terminal as never, clipboard)).rejects.toThrow('clipboard denied')
```

- [ ] **Step 2: Add failing debounced copy controller tests**

Use fake timers and an xterm selection callback stub. Assert that repeated changes produce one final clipboard write, disabling cancels the timer, empty selections do not write, errors call `onError`, and dispose unsubscribes exactly once.

- [ ] **Step 3: Run focused tests to verify RED**

```bash
cd frontend
npm test -- src/lib/terminalInteractions.test.ts src/components/terminal/terminalBehaviorRuntime.test.ts
```

Expected: FAIL because the runtime files do not exist.

- [ ] **Step 4: Implement clipboard helpers and controller**

Use this public shape in `terminalInteractions.ts`:

```ts
export interface CopyOnSelectController {
  setEnabled: (enabled: boolean) => void
  dispose: () => void
}

export function createCopyOnSelectController(term: Terminal, options: {
  clipboard?: Pick<Clipboard, 'writeText'>
  delay?: number
  onError?: (error: unknown) => void
}): CopyOnSelectController
```

The controller owns one timer, subscribes once to `term.onSelectionChange`, copies the latest non-empty selection after 120 ms by default, cancels when disabled, and makes `dispose` idempotent.

- [ ] **Step 5: Bind controllers to the behavior store**

Implement `installTerminalCopyOnSelect`:

```ts
export function installTerminalCopyOnSelect(term: Terminal, label: string) {
  const controller = createCopyOnSelectController(term, {
    onError: (error) => logger.error(`${label} automatic selection copy failed`, error),
  })
  controller.setEnabled(useTerminalBehaviorStore.getState().copyOnSelect)
  const unsubscribe = useTerminalBehaviorStore.subscribe((state, previous) => {
    if (state.copyOnSelect !== previous.copyOnSelect) controller.setEnabled(state.copyOnSelect)
  })
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    unsubscribe()
    controller.dispose()
  }
}
```

- [ ] **Step 6: Run focused tests to verify GREEN**

```bash
cd frontend
npm test -- src/lib/terminalInteractions.test.ts src/components/terminal/terminalBehaviorRuntime.test.ts
```

Expected: both files PASS.

- [ ] **Step 7: Include the helper in coverage and commit**

Add `src/lib/terminalInteractions.ts` to `frontend/vite.config.ts`, then commit:

```bash
git add frontend/src/lib/terminalInteractions.ts frontend/src/lib/terminalInteractions.test.ts frontend/src/components/terminal/terminalBehaviorRuntime.ts frontend/src/components/terminal/terminalBehaviorRuntime.test.ts frontend/vite.config.ts
git commit -m "feat(terminal): add interaction runtime"
```

### Task 4: Apply Right-Click Behavior To Live SSH Terminals

**Files:**
- Create: `frontend/src/components/terminal/TerminalInteractionSurface.tsx`
- Create: `frontend/src/components/terminal/TerminalInteractionSurface.test.tsx`
- Modify: `frontend/src/components/terminal/TerminalEmulator.tsx:1-28`
- Modify: `frontend/src/components/terminal/TerminalEmulator.test.tsx`
- Modify: `frontend/src/hooks/useTerminal.ts:145-205`
- Modify: `frontend/src/hooks/useTerminal.test.tsx`

**Interfaces:**
- Consumes: Task 1 behavior store and Task 3 clipboard/runtime helpers.
- Produces: shadcn right-click menu for interactive terminals.
- Produces: direct right-click paste mode.
- Installs: live-terminal copy-on-select during xterm initialization.

- [ ] **Step 1: Add failing interaction-surface tests**

Mock the shadcn context-menu primitives as visible wrappers. Cover:

```tsx
render(<TerminalInteractionSurface terminalRef={terminalRef}><div>terminal</div></TerminalInteractionSurface>)
```

Assertions:

- Menu mode exposes `复制`, `粘贴`, and `全选`.
- Copy is disabled when `getSelection()` is empty.
- Each action calls the Task 3 helper and restores focus.
- Paste mode prevents `contextmenu`, reads the clipboard, and does not render menu items.
- Explicit clipboard rejection logs and adds an error toast.
- Changing the store from menu to paste rerenders the already-mounted surface.

- [ ] **Step 2: Add failing live lifecycle tests**

Extend the xterm mock in `useTerminal.test.tsx` with `getSelection` and `onSelectionChange`. Assert initialization installs the behavior runtime and StrictMode cleanup disposes its selection subscription once.

- [ ] **Step 3: Run focused tests to verify RED**

```bash
cd frontend
npm test -- src/components/terminal/TerminalInteractionSurface.test.tsx src/components/terminal/TerminalEmulator.test.tsx src/hooks/useTerminal.test.tsx
```

Expected: FAIL because the interaction surface and selection lifecycle are absent.

- [ ] **Step 4: Implement the live interaction surface**

`TerminalInteractionSurface` reads `rightClickAction` with a Zustand selector. In menu mode it wraps children with existing `ContextMenu`, `ContextMenuTrigger`, `ContextMenuContent`, and `ContextMenuItem`. It reads `terminalRef.current` at action time, updates copy disabled state during `onContextMenuCapture`, and uses `Copy`, `ClipboardPaste`, and `TextSelect` icons.

In paste mode render a full-size wrapper with:

```tsx
onContextMenu={(event) => {
  event.preventDefault()
  void paste().catch(reportExplicitClipboardError)
}}
```

- [ ] **Step 5: Wrap TerminalEmulator and install copy-on-select**

Wrap the existing xterm container:

```tsx
const terminalRef = useTerminal(terminalID, containerRef, { active, focusRequest })
return <TerminalInteractionSurface terminalRef={terminalRef}>{container}</TerminalInteractionSurface>
```

In `initializeTerminal`, call `installTerminalCopyOnSelect(term, 'terminal')` after `term.open`, and invoke its cleanup before disposing the terminal.

- [ ] **Step 6: Run focused tests to verify GREEN**

```bash
cd frontend
npm test -- src/components/terminal/TerminalInteractionSurface.test.tsx src/components/terminal/TerminalEmulator.test.tsx src/hooks/useTerminal.test.tsx
```

Expected: all focused files PASS.

- [ ] **Step 7: Commit live terminal interactions**

```bash
git add frontend/src/components/terminal/TerminalInteractionSurface.tsx frontend/src/components/terminal/TerminalInteractionSurface.test.tsx frontend/src/components/terminal/TerminalEmulator.tsx frontend/src/components/terminal/TerminalEmulator.test.tsx frontend/src/hooks/useTerminal.ts frontend/src/hooks/useTerminal.test.tsx
git commit -m "feat(terminal): apply mouse behavior"
```

### Task 5: Apply Copy-On-Select To Playback Terminals

**Files:**
- Create: `frontend/src/components/terminal/PlaybackControls.tsx`
- Create: `frontend/src/components/terminal/PlaybackControls.test.tsx`
- Modify: `frontend/src/components/terminal/PlaybackTab.tsx:1-308`
- Modify: `frontend/src/components/terminal/PlaybackTab.test.tsx`

**Interfaces:**
- Consumes: `installTerminalCopyOnSelect` from Task 3.
- Produces: playback selection copying with no right-click paste or interactive context menu.
- Extracts: existing header and timeline UI so `PlaybackTab.tsx` remains below 300 lines.

- [ ] **Step 1: Add failing playback selection tests**

Extend the playback xterm mock with `getSelection` and `onSelectionChange`. Enable `copyOnSelect` in the store, initialize playback, invoke the selection callback, advance fake timers by 120 ms, and assert clipboard text is written. Disable the setting and assert later selections do not write.

Add cleanup assertions for the selection subscription and pending timer.

- [ ] **Step 2: Add characterization tests for extracted controls**

Create `PlaybackControls.test.tsx` with this behavior:

```tsx
const onToggle = vi.fn()
const onSeek = vi.fn()
const onSpeed = vi.fn()
render(<><PlaybackHeader title="demo" playing={false} disabled={false} speed={1} onToggle={onToggle} /><PlaybackTimeline progress={25} speed={1} onSeek={onSeek} onSpeed={onSpeed} /></>)
await userEvent.click(screen.getByRole('button', { name: '开始回放' }))
await userEvent.click(screen.getByRole('button', { name: '2x' }))
expect(onToggle).toHaveBeenCalledOnce()
expect(onSpeed).toHaveBeenCalledWith(2)
expect(screen.getByText('回放: demo')).toBeInTheDocument()
```

Add these assertions:

```tsx
const { rerender } = render(<PlaybackHeader title="demo" playing={false} disabled speed={1} onToggle={onToggle} />)
expect(screen.getByRole('button', { name: '开始回放' })).toBeDisabled()
rerender(<PlaybackTimeline progress={25} speed={1} onSeek={onSeek} onSpeed={onSpeed} />)
const slider = screen.getByRole('slider', { name: '回放进度' })
slider.focus()
await userEvent.keyboard('{ArrowRight}')
expect(onSeek).toHaveBeenCalledWith(26)
```

- [ ] **Step 3: Run focused tests to verify RED**

```bash
cd frontend
npm test -- src/components/terminal/PlaybackTab.test.tsx src/components/terminal/PlaybackControls.test.tsx
```

Expected: FAIL because playback does not install copy-on-select and the controls file does not exist.

- [ ] **Step 4: Extract playback controls without behavior changes**

Move `PlaybackHeader`, `PlaybackTimeline`, `PLAYBACK_SPEEDS`, and the associated markup to `PlaybackControls.tsx`. Export two focused components:

```tsx
const PLAYBACK_SPEEDS = [0.5, 1, 2, 4]

export function PlaybackHeader({ title, playing, disabled, speed, onToggle }: HeaderProps) {
  return <div className="flex h-8 items-center gap-2 border-b bg-muted/30 px-2">
    <span className="text-xs text-muted-foreground">回放: {title}</span>
    <div className="flex-1" />
    <Button size="xs" variant="ghost" aria-label={playing ? '暂停回放' : '开始回放'} disabled={disabled} onClick={onToggle}>
      {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
    </Button>
    <span className="text-xs text-muted-foreground">{speed}x</span>
  </div>
}

export function PlaybackTimeline({ progress, speed, onSeek, onSpeed }: TimelineProps) {
  return <div className="flex items-center gap-2 border-t border-border bg-muted/30 px-3 py-1.5">
    <Slider aria-label="回放进度" value={[progress]} min={0} max={100} onValueChange={(value) => onSeek(typeof value === 'number' ? value : value[0])} className="flex-1" />
    <div className="flex flex-shrink-0 items-center gap-1">
      {PLAYBACK_SPEEDS.map((value) => <Button key={value} size="xs" variant={speed === value ? 'default' : 'ghost'} className="text-xs" onClick={() => onSpeed(value)}>{value}x</Button>)}
    </div>
  </div>
}
```

Keep `PlaybackHeader` above the terminal container and `PlaybackTimeline` below it. Keep both source files below 300 lines.

- [ ] **Step 5: Install playback copy-on-select**

In `usePlaybackLifecycle`, install after opening the terminal:

```ts
const disposeCopyOnSelect = installTerminalCopyOnSelect(term, 'playback')
```

Invoke `disposeCopyOnSelect()` during cleanup before `term.dispose()`. Do not add context-menu or paste behavior to playback.

- [ ] **Step 6: Run focused tests to verify GREEN**

```bash
cd frontend
npm test -- src/components/terminal/PlaybackTab.test.tsx src/components/terminal/PlaybackControls.test.tsx
```

Expected: both files PASS and `wc -l frontend/src/components/terminal/PlaybackTab.tsx` reports at most 300 lines.

- [ ] **Step 7: Commit playback behavior**

```bash
git add frontend/src/components/terminal/PlaybackControls.tsx frontend/src/components/terminal/PlaybackControls.test.tsx frontend/src/components/terminal/PlaybackTab.tsx frontend/src/components/terminal/PlaybackTab.test.tsx
git commit -m "feat(playback): copy selected text"
```

### Task 6: Full Verification, Review, And Delivery

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-07-14-terminal-input-behavior.md`

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces: fully verified and pushed `main` with no generated artifacts.

- [ ] **Step 1: Update concise user documentation**

Add one short README bullet under settings or terminal capabilities:

```markdown
- Terminal behavior settings support right-click menus or paste and optional copy-on-select.
```

- [ ] **Step 2: Run frontend coverage**

```bash
cd frontend
npm run test:coverage
```

Expected: all tests PASS and line coverage is at least 90%.

- [ ] **Step 3: Run Go formatting and tests**

```bash
export PATH="$HOME/.govm/go/bin:$HOME/go/bin:$PATH"
goimports-reviser -project-name github.com/xuthus5/mssh -rm-unused -set-alias -format ./...
go test ./...
go test -race -coverprofile=coverage.out -covermode=atomic -coverpkg=./internal/...,./pkg/... ./internal/... ./pkg/...
go tool cover -func=coverage.out | tail -1
```

Expected: tests PASS, race detection reports no races, and total Go coverage is at least 90%.

- [ ] **Step 4: Run lint and production build**

```bash
export PATH="$HOME/.govm/go/bin:$HOME/go/bin:$PATH"
CGO_ENABLED=1 CC='gcc -fuse-ld=bfd' golangci-lint run --timeout 5m ./...
CGO_ENABLED=1 CC='gcc -fuse-ld=bfd' wails3 build
```

Expected: `0 issues` and successful Wails build. The existing Vite chunk-size warning remains non-blocking.

- [ ] **Step 5: Request final code review**

Use `requesting-code-review` against the complete feature diff. Reject any implementation that:

- applies right-click paste to playback,
- updates the runtime store before database save succeeds,
- loses the default `menu` and `false` behavior,
- creates repeated clipboard writes while dragging,
- leaks xterm subscriptions or timers,
- requires reconnecting existing terminals,
- exceeds the project file or function limits.

Fix every Critical and Important finding, then rerun affected focused tests and the final gates.

- [ ] **Step 6: Clean outputs and close the plan**

```bash
rm -rf frontend/coverage frontend/dist
rm -f coverage.out build/bin/mssh
git diff --check
git status --short
```

Mark every completed checkbox in this plan with `[x]`. Confirm only intended source, tests, README, and plan files remain.

- [ ] **Step 7: Commit and push the completed feature**

```bash
git add README.md docs/superpowers/plans/2026-07-14-terminal-input-behavior.md
git commit -m "docs(settings): close behavior plan"
git push origin main
git status --short --branch
```

Expected: `main` matches `origin/main` and the working tree is clean.
