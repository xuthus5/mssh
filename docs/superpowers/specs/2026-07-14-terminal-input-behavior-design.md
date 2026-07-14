# Terminal Input Behavior Design

## Goal

Add a commercial-quality **Behavior** section to General Settings that controls terminal mouse interactions. The first release supports configurable right-click behavior and optional copy-on-select, persists both options in the existing settings table, and applies changes to already-open terminals without reconnecting.

## User Experience

General Settings gains a shadcn-style card named `行为`, using the existing `rounded-xl border border-border bg-card shadow-sm` treatment.

The card contains two controls:

1. `鼠标右键行为`
   - `显示菜单` is the default.
   - `粘贴` reads the system clipboard and pastes it into the active interactive SSH terminal.
2. `选择即复制`
   - Uses a shadcn `Switch`.
   - Disabled by default.
   - Applies to interactive SSH terminals and recording playback terminals.

The terminal context menu contains:

- `复制`, disabled when the terminal has no selection.
- `粘贴`.
- `全选`.

The right-click setting applies only to interactive SSH terminals. Playback terminals remain read-only and only consume the copy-on-select setting.

## Defaults And Persistence

The existing generic `settings` table stores the feature without a schema change:

| Key | Type | Default | Valid Values |
| --- | --- | --- | --- |
| `terminal.right_click_action` | string | `menu` | `menu`, `paste` |
| `terminal.copy_on_select` | boolean | `false` | `true`, `false` |

Missing or malformed values fall back to the defaults. Saving General Settings writes these values through `SettingService.SetMany` together with the existing general settings so the form has one success or failure boundary.

## Frontend Architecture

Create a dedicated terminal behavior store rather than expanding `appStore` or passing settings through the application component tree.

The store exposes:

```ts
export type TerminalRightClickAction = 'menu' | 'paste'

export interface TerminalBehaviorSettings {
  rightClickAction: TerminalRightClickAction
  copyOnSelect: boolean
}
```

It owns the defaults and a single action that replaces the current settings. `useSettings` remains responsible for database loading and saving, then updates the behavior store only after normalized values are available. This gives already-open SSH and playback terminals immediate access to the latest values.

Shared terminal interaction helpers own clipboard behavior, selection coalescing, and error handling. They accept an xterm `Terminal` instance and do not depend on React components or Wails services, which keeps live and playback behavior consistent and independently testable.

## Interactive SSH Terminals

Each `TerminalEmulator` renders a terminal interaction surface around the xterm container.

When the right-click action is `menu`, the surface uses the existing shadcn context-menu components. Menu actions operate on the terminal instance registered in `appStore.terminalPool`:

- Copy writes `terminal.getSelection()` to the browser clipboard.
- Paste reads the clipboard and calls `terminal.paste(text)` so existing xterm input handling remains authoritative.
- Select all calls `terminal.selectAll()` and restores terminal focus after the menu closes.

When the right-click action is `paste`, the xterm container prevents the native context menu, reads the clipboard, calls `terminal.paste(text)`, and restores focus. The setting is read at event time so saving settings changes existing terminals without rebuilding their xterm instances.

Copy-on-select subscribes to xterm selection changes. A short debounce copies only the final non-empty selection after dragging settles, preventing repeated clipboard writes during pointer movement. Disabling the option cancels pending automatic copies.

## Playback Terminals

Playback remains read-only and does not render the interactive context menu or support right-click paste. Its xterm lifecycle subscribes only to copy-on-select through the same shared selection helper used by interactive terminals.

## Error Handling

Explicit user actions from the context menu or right-click paste report clipboard failures through the application logger and an error toast. Automatic copy-on-select failures are logged without repeated toasts because selection events can occur frequently and clipboard access may be restricted by the desktop environment.

Saving settings follows the existing General Settings behavior:

- On success, persist all values, update React state, then update the behavior store.
- On failure, preserve the previously persisted behavior store values, show the existing save failure toast, and keep the form values available for retry.

All event subscriptions, debounce timers, and DOM listeners are disposed during terminal cleanup.

## Testing

Frontend tests cover:

- Default values when settings are missing or malformed.
- Loading and saving both database keys.
- The Behavior card, labeled select, switch, and submitted `GeneralSettings` values.
- Right-click menu actions and disabled copy state.
- Right-click paste mode and clipboard failure reporting.
- Debounced copy-on-select for live SSH terminals.
- Copy-on-select for playback terminals.
- Immediate behavior changes for already-open terminals.
- Cleanup of selection subscriptions, timers, and context-menu listeners.

Existing Go setting storage and service tests already cover typed generic settings persistence. No Go model, service API, binding, dependency, or database schema change is required.

## Out Of Scope

- Keyboard shortcut remapping.
- Per-session behavior overrides.
- Middle-click paste.
- Playback right-click menus.
- Clipboard history or multi-entry paste selection.
