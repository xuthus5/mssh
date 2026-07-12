# Session Asset Workspace Design

## Goal

Move session management out of a sidebar-only interaction model into a full session asset workspace. The application shows the welcome page once per process start, then permanently switches to the normal workspace after the user selects Sessions or Macros.

## Startup Behavior

- The welcome page is not a workspace route and is not represented in the workspace navigation enum.
- A process-local `hasEnteredWorkspace` boolean starts as `false` on every application launch.
- While `hasEnteredWorkspace` is `false`, the main content renders only the welcome page. The session tree and macro panel are not visible.
- Clicking the title-bar Sessions or Macros navigation sets `hasEnteredWorkspace` to `true` and selects the requested workspace.
- Opening a session through any supported shortcut also sets `hasEnteredWorkspace` to `true`.
- Once the flag becomes `true`, the welcome page cannot reappear during that process lifetime. Closing the final terminal returns to the selected workspace, not to the welcome page.
- Restarting the application resets the flag and shows the welcome page again.

## Workspace Navigation

The existing `SidebarTab` concept becomes a normal workspace selection with two values:

- `sessions`: full session asset workspace.
- `macros`: existing macro workflow, preserved without introducing a welcome route.

The title-bar navigation controls the selected workspace. Terminal and playback tabs remain application tabs layered over the selected workspace. When no terminal or playback tab is active, the selected workspace is visible.

## Session Workspace Layout

The Sessions workspace uses a two-column operational layout:

- Left column: compact, resizable, collapsible session tree.
- Right column: session asset center using the remaining width.

The left tree is limited to navigation-oriented behavior:

- Search sessions and folders.
- Expand or collapse folder hierarchy.
- Select a folder to filter the asset center.
- Double-click a session to connect.
- Preserve session drag-and-drop between folders.

Creation, editing, deletion, default-folder selection, and other asset-management actions move to the right asset center. This keeps the tree dense and prevents duplicated management controls.

## Session Asset Center

The asset center header contains the page title, summary text, search where relevant, and one Create menu with two commands:

- Create session.
- Create folder.

The content uses three top-level tabs.

### Recent Connections

- Displays up to ten sessions ordered by successful connection time descending.
- Excludes sessions that have never connected successfully.
- Shows name, endpoint, folder, last successful connection time, connection count, and a Connect command.
- Supports opening session editing from the row action menu.
- Empty state directs the user to connect to a session or create one.

### Folders

- Displays every folder with hierarchy context, node count, default status, and row actions.
- Clicking the folder name switches to the All Nodes tab and activates that folder as the filter.
- Row actions include Rename, Set as default, and Delete.
- The default folder action is disabled for the current default folder.
- Delete is disabled for the default folder and when only one folder exists.
- Before deletion, the confirmation explains that sessions and child folders will move to the default folder.
- Existing backend deletion semantics remain authoritative.

### All Nodes

- Displays every session in a scan-friendly table.
- Supports text search and folder filtering.
- When entered from a folder, the breadcrumb reads `All Nodes / <folder name>` and provides a command to return to all nodes.
- Row commands include Connect, Edit, Move to folder, and Delete.
- Clicking a folder in the compact tree applies the same folder filter and selects this tab.

## Folder Management Migration

- Remove the Folder category and `FolderManager` rendering from Settings.
- Remove folder-management props from `SettingsDialog` after the session asset center owns the workflow.
- Keep the existing service methods and database constraints as the single business-logic implementation.
- Do not maintain duplicate folder management UI in Settings or the compact tree.

## Recent Connection Persistence

The `sessions` table gains:

- `last_connected_at DATETIME NULL`.
- `connection_count INTEGER NOT NULL DEFAULT 0`.

The session model and generated Wails bindings expose both fields. No historical inference is attempted; existing sessions start with no successful connection timestamp and a zero count.

After SSH authentication and connection setup succeed, the backend updates the session in one parameterized statement:

```sql
UPDATE sessions
SET last_connected_at = datetime('now'),
    connection_count = connection_count + 1
WHERE id = ?
```

Failed, rejected, cancelled, or timed-out attempts do not update recency. A dedicated service query returns at most ten recent sessions, ordered by `last_connected_at DESC, id DESC`.

Failure to persist recent-connection metadata must not tear down an already successful SSH connection. The backend logs the metadata error with the session ID while preserving the active terminal.

## Component Boundaries

- `App.tsx`: app shell, welcome-once behavior, terminal/playback overlay selection.
- `WindowTitleBar.tsx`: selects Sessions or Macros and enters the workspace.
- `SessionWorkspace.tsx`: composes compact tree and asset center and owns shared dialogs.
- `CompactSessionTree.tsx`: navigation-only tree surface.
- `SessionAssetCenter.tsx`: tab state, create menu, selected-folder filter, and shared search state.
- `RecentSessionsView.tsx`: recent connection list.
- `FolderAssetsView.tsx`: folder table and folder commands.
- `SessionAssetsView.tsx`: all-session table and filters.
- `useSession.ts`: shared session/folder state and mutation actions, including recent-session loading.

The existing oversized `Sidebar.tsx` is split as part of this work because its current responsibilities span sessions, macros, dialogs, settings, resizing, and asset actions. The refactor remains scoped to enabling the approved workspace behavior.

## Error Handling

- List failures render an inline destructive alert with Retry.
- Mutation failures preserve the current table/tree state and show a toast with the backend message.
- Destructive actions use confirmation dialogs rather than `window.confirm`.
- Recent-connection metadata write failures are logged by the backend and do not invalidate successful SSH connections.
- Loading states use stable skeleton dimensions to avoid workspace layout shifts.

## Accessibility and Interaction

- Tabs use proper tab roles and keyboard navigation.
- Tables expose descriptive action labels including the session or folder name.
- Menus and dialogs return focus to their trigger.
- Compact-tree rows remain keyboard reachable; double-click is supplemented by an explicit Connect action in the asset center.
- Collapsed and resized tree behavior retains the existing persisted panel dimensions.

## Testing and Verification

Frontend tests cover:

- Welcome page visible on startup without the session tree.
- Sessions and Macros navigation permanently dismisses the welcome page for the process lifetime.
- Closing the final terminal returns to the selected workspace.
- Three asset tabs, Create menu commands, recent-session limit, folder filtering, breadcrumbs, and row actions.
- Folder rename, default selection, deletion confirmation, protected-action states, and Settings folder-category removal.
- Compact-tree selection and double-click connection behavior.

Go tests cover:

- New schema columns and zero-value mapping.
- Recency update only after successful connection.
- Connection count increments across successful connections.
- Recent query ordering, ten-row limit, and exclusion of never-connected sessions.
- Metadata update failure does not convert a successful SSH connection into a failed connection.

Completion requires `goimports-reviser`, `golangci-lint`, Go race tests, repository coverage of at least 90%, frontend tests, frontend production build, and `wails3 build`.
