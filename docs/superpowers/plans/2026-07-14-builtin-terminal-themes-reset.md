# Built-in Terminal Themes Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reproducible 24-theme built-in terminal catalog and reset the currently assigned Dark/Light built-in profile styles from the settings page.

**Architecture:** A standard-library generator downloads an explicit manifest from the pinned `mbadolato/iTerm2-Color-Schemes` commit and emits compile-time Go definitions. `ThemeService` transactionally ensures the catalog and resets assigned built-in profiles, while the React catalog hook reloads and hot-applies the result after a shadcn confirmation flow.

**Tech Stack:** Go 1.26, SQLite, Wails v3 bindings, React 19, TypeScript, Zustand, shadcn/ui, Vitest, Testing Library.

## Global Constraints

- Bundle exactly 24 themes: 12 Dark and 12 Light.
- Pin upstream commit `c3968b385e8072d61651eb8e32f498703058c2fd`.
- Runtime initialization and reset must not access the network.
- Do not change the database schema.
- Reset only style fields on currently assigned profiles backed by built-in definitions.
- Preserve profile names, assignments, custom themes, and imported themes.
- All created directories use `0700`; all created files use `0600` unless executable permission is required.
- Keep functions at 50 lines or fewer and source files at 300 lines or fewer.
- Run frontend coverage, Go tests, race detection, lint, and `wails3 build` before delivery.

---

### Task 1: Reproducible Built-in Theme Catalog

**Files:**
- Create: `cmd/themegen/main.go`
- Create: `internal/service/builtin_themes_generate.go`
- Create: `internal/service/builtin_themes_gen.go`
- Create: `internal/service/builtin_themes_test.go`
- Modify: `internal/themeimport/itermcolors.go`
- Modify: `internal/themeimport/itermcolors_test.go`

**Interfaces:**
- Produces: `func builtinThemeDefinitions() []model.ThemeDefinition`
- Produces: `func themeimport.ClassifyMode(background string) model.ThemeMode`
- Produces: `go generate ./internal/service` regeneration entry point.

- [x] **Step 1: Add failing catalog and classifier tests**

Add tests that assert:

```go
definitions := builtinThemeDefinitions()
require.Len(t, definitions, 24)
assert.Len(t, filterMode(definitions, model.ThemeModeDark), 12)
assert.Len(t, filterMode(definitions, model.ThemeModeLight), 12)
```

For every definition, decode `ColorPayload`, require 16 ANSI colors, validate all colors against `^#[0-9a-f]{6}$`, verify source metadata and assert `themeimport.ClassifyMode(payload.Background) == definition.Mode`. Assert all fingerprints are unique.

Rename the private classifier test target to the exported `ClassifyMode` and cover black, white, threshold-adjacent, and mixed RGB backgrounds.

- [x] **Step 2: Verify RED**

Run:

```bash
PATH="$HOME/.govm/go/bin:$PATH" go test ./internal/service ./internal/themeimport
```

Expected: FAIL because `builtinThemeDefinitions` and `themeimport.ClassifyMode` do not exist.

- [x] **Step 3: Implement the generator and exported classifier**

Use an explicit manifest in `cmd/themegen/main.go` containing the 24 approved filenames and declared modes. Download from:

```text
https://raw.githubusercontent.com/mbadolato/iTerm2-Color-Schemes/c3968b385e8072d61651eb8e32f498703058c2fd/schemes/<url-escaped-name>.itermcolors
```

Parse each file with `themeimport.NewITermColorsImporter`, reject a generated mode mismatch, override metadata with:

```go
definition.SourceType = model.ThemeSourceBuiltin
definition.SourceName = "iTerm2 Color Schemes"
definition.SourceURL = rawURL
definition.SourceAuthor = "Mark Badolato / iTerm2 Color Schemes contributors"
definition.SourceLicense = "MIT collection; individual rights retained"
definition.SourceVersion = upstreamCommit
definition.IsBuiltin = true
definition.RawPayload = ""
```

Emit formatted Go source containing `builtinThemeDefinitions`. Write through a `0600` temporary file and rename it over `internal/service/builtin_themes_gen.go`.

Add:

```go
//go:generate go run ../../cmd/themegen
```

Export the existing luminance classifier as `ClassifyMode` and update importer usage.

- [x] **Step 4: Generate and verify GREEN**

Run:

```bash
PATH="$HOME/.govm/go/bin:$PATH" go generate ./internal/service
PATH="$HOME/.govm/go/bin:$PATH" go test ./internal/service ./internal/themeimport
```

Expected: generated file contains 24 definitions and both packages PASS.

### Task 2: Transactional Initialization And Reset

**Files:**
- Modify: `internal/model/theme.go`
- Modify: `internal/service/theme.go`
- Modify: `internal/service/theme_test.go`
- Modify: `internal/store/theme.go`
- Modify: `internal/store/theme_test.go`

**Interfaces:**
- Produces: `model.BuiltinThemeResetResult{DarkReset bool, LightReset bool}`
- Produces: `func (service *ThemeService) ResetBuiltinStyles() (model.BuiltinThemeResetResult, error)`
- Produces: transactional initialization of all definitions and profiles.

- [x] **Step 1: Add failing initialization and reset tests**

Cover these observable cases:

```go
require.NoError(t, themeService.InitializeDefaults())
definitions, _ := themeService.ListDefinitions("")
profiles, _ := themeService.ListProfiles("")
require.Len(t, definitions, 24)
require.Len(t, profiles, 24)
```

Run initialization twice and assert counts remain unchanged. Select the unassigned Dracula definition, delete its Profile with `DELETE FROM terminal_theme_profiles WHERE theme_id = ?`, delete the definition with `DELETE FROM themes WHERE id = ?`, initialize again, and assert both records are restored. Modify a profile style before initialization and assert it is not overwritten.

For reset, assign one built-in profile and one imported/custom profile, mutate both, call `ResetBuiltinStyles`, and assert:

```go
assert.True(t, result.DarkReset)
assert.False(t, result.LightReset)
assert.Equal(t, defaultTerminalFont, dark.FontFamily)
assert.Equal(t, 14, dark.FontSize)
assert.Equal(t, model.CursorStyleBar, dark.CursorStyle)
assert.JSONEq(t, `{}`, dark.ColorOverrides)
assert.Equal(t, customBefore, customAfter)
assert.Equal(t, assignmentsBefore, assignmentsAfter)
```

Add database failure tests for begin, update, and commit/rollback paths.

- [x] **Step 2: Verify RED**

Run:

```bash
PATH="$HOME/.govm/go/bin:$PATH" go test ./internal/service ./internal/store
```

Expected: FAIL because initialization still creates two themes and reset is missing.

- [x] **Step 3: Refactor initialization to one transaction**

Change helpers to consume `store.themeDB`-compatible values indirectly through existing store functions:

```go
type themeStore interface {
    Exec(query string, args ...any) (sql.Result, error)
    Query(query string, args ...any) (*sql.Rows, error)
    QueryRow(query string, args ...any) *sql.Row
}

func (service *ThemeService) ensureBuiltin(db themeStore, definition model.ThemeDefinition) (int64, error)
func (service *ThemeService) ensureProfile(db themeStore, name string, themeID int64) (int64, error)
```

If a service-local interface is needed, define only `Exec`, `Query`, and `QueryRow`. Loop over `builtinThemeDefinitions`, collect GitHub Dark/Light profile IDs, repair invalid assignments, save assignments through `store.SaveThemeAssignmentsDB`, and commit once. Roll back on every failure.

- [x] **Step 4: Implement reset transaction**

Add the model:

```go
type BuiltinThemeResetResult struct {
    DarkReset  bool `json:"dark_reset"`
    LightReset bool `json:"light_reset"`
}
```

Implement `ResetBuiltinStyles` by initializing defaults, starting a transaction, reading assignments, and resetting each assigned profile only when `profile.Definition.IsBuiltin` is true. Preserve `Name`, `ThemeID`, and assignment IDs; set only:

```go
profile.FontFamily = defaultTerminalFont
profile.FontSize = 14
profile.CursorStyle = model.CursorStyleBar
profile.ColorOverrides = `{}`
```

Commit once and return the per-mode result.

- [x] **Step 5: Verify GREEN**

Run:

```bash
PATH="$HOME/.govm/go/bin:$PATH" go test ./internal/service ./internal/store
```

Expected: PASS with initialization, reset, idempotency, and error paths covered.

### Task 3: Wails Binding And Catalog Hook

**Files:**
- Modify generated: `frontend/bindings/github.com/xuthus5/mssh/internal/model/models.ts`
- Modify generated: `frontend/bindings/github.com/xuthus5/mssh/internal/service/themeservice.ts`
- Modify: `frontend/src/hooks/useThemeCatalog.ts`
- Modify: `frontend/src/hooks/useThemeCatalog.test.tsx`

**Interfaces:**
- Consumes: `ThemeService.ResetBuiltinStyles()`
- Produces: `resetBuiltinStyles(): Promise<BuiltinThemeResetResult>` from `useThemeCatalog`.

- [x] **Step 1: Add failing hook test**

Register a Wails mock for `ThemeService.ResetBuiltinStyles`, call `result.current.resetBuiltinStyles()`, and assert the hook:

1. Calls the backend once.
2. Reloads definitions, profiles, and assignments.
3. Applies the reloaded active-mode profile to `appStore.terminalTheme`.
4. Returns `{ dark_reset: true, light_reset: false }` unchanged.

- [x] **Step 2: Verify RED**

Run:

```bash
cd frontend && npm test -- useThemeCatalog.test.tsx
```

Expected: FAIL because the hook action and generated binding are missing.

- [x] **Step 3: Generate bindings and add hook action**

Run:

```bash
PATH="$HOME/.govm/go/bin:$PATH" wails3 generate bindings -ts -names -d frontend/bindings/ .
```

Add:

```ts
export async function resetBuiltinStyles() {
  const result = await ThemeService.ResetBuiltinStyles()
  await loadThemeCatalogFresh()
  applyColorMode(useThemeCatalogStore.getState().colorMode)
  return result
}
```

Expose it from `useThemeCatalog`.

- [x] **Step 4: Verify GREEN**

Run:

```bash
cd frontend && npm test -- useThemeCatalog.test.tsx
```

Expected: PASS.

### Task 4: Settings Reset Interaction

**Files:**
- Modify: `frontend/src/components/settings/ThemeEditor.tsx`
- Modify: `frontend/src/components/settings/ThemeEditor.test.tsx`
- Modify: `frontend/src/components/settings/SettingsDialog.tsx`
- Modify: `frontend/src/components/settings/SettingsDialog.test.tsx`
- Modify: `frontend/src/components/layout/Sidebar.tsx`

**Interfaces:**
- Consumes: `onResetBuiltins(): Promise<BuiltinThemeResetResult>`
- Produces: confirmed reset button with disabled, loading, success, and failure states.

- [x] **Step 1: Add failing interaction tests**

Add tests for:

- Button name `重置内置主题` and `RotateCcw` icon.
- Disabled button and explanatory tooltip when neither assigned definition is built-in.
- AlertDialog opens and cancellation does not call reset.
- Confirmation calls reset once and disables repeated confirmation while pending.
- `{dark_reset: true, light_reset: true}` shows `已重置 Dark 和 Light 内置主题`.
- Dark-only, Light-only, and zero-item results show precise messages.
- Rejected reset shows `重置内置主题失败` and leaves editor inputs unchanged.
- `SettingsDialog` and `Sidebar` pass the callback through correctly.

- [x] **Step 2: Verify RED**

Run:

```bash
cd frontend && npm test -- ThemeEditor.test.tsx SettingsDialog.test.tsx
```

Expected: FAIL because reset props and UI are missing.

- [x] **Step 3: Implement shadcn reset flow**

Add `onResetBuiltins` to the editor and dialog props. Derive assigned profiles from `assignments`; enable reset when either assigned definition has `is_builtin === true`.

Use existing shadcn components:

```tsx
<Button type="button" variant="outline" onClick={() => setResetOpen(true)} disabled={!canReset || resetting}>
  <RotateCcw data-icon="inline-start" />
  重置内置主题
</Button>
```

Compose `AlertDialog`, `AlertDialogTitle`, `AlertDialogDescription`, cancel, and confirm actions. The async confirm catches errors, uses the existing toast API, closes only on success, and formats the backend result without changing drafts directly; the catalog reload updates props and recreates drafts.

- [x] **Step 4: Verify GREEN**

Run:

```bash
cd frontend && npm test -- ThemeEditor.test.tsx SettingsDialog.test.tsx useThemeCatalog.test.tsx
```

Expected: PASS.

### Task 5: Attribution And Documentation

**Files:**
- Create: `THIRD_PARTY_NOTICES.md`
- Modify: `README.md`
- Test: `internal/service/builtin_themes_test.go`

**Interfaces:**
- Consumes: pinned catalog metadata.
- Produces: distributable attribution for the bundled collection and selected theme names.

- [x] **Step 1: Add metadata assertions**

Assert every generated definition uses the pinned commit, exact source name, exact author text, non-empty fixed-commit URL, and `MIT collection; individual rights retained`.

- [x] **Step 2: Write third-party notice**

Create `THIRD_PARTY_NOTICES.md` with the upstream repository URL, fixed commit, all 24 theme names, the collection copyright, the MIT license text, and the upstream statement that individual theme rights belong to their authors.

Update the README terminal theme feature bullet to mention 24 curated offline built-ins, Dark/Light assignment, `.itermcolors` import, and reset support in one concise line.

- [x] **Step 3: Verify documentation and focused tests**

Run:

```bash
rg -n "c3968b385e8072d61651eb8e32f498703058c2fd|Dracula|3024 Day" THIRD_PARTY_NOTICES.md internal/service/builtin_themes_gen.go
PATH="$HOME/.govm/go/bin:$PATH" go test ./internal/service
```

Expected: metadata appears in generated data and notices; tests PASS.

### Task 6: Final Verification And Delivery

**Files:**
- Modify only files required by verified failures.

**Interfaces:**
- Consumes: completed Tasks 1-5.
- Produces: formatted, tested, built, committed, and pushed implementation.

- [x] **Step 1: Run frontend tests and coverage**

```bash
cd frontend
npm test
npm run test:coverage
```

Expected: all tests pass and line/function coverage remains at least 90%.

- [x] **Step 2: Run Go formatting and quality gates**

```bash
PATH="$HOME/.govm/go/bin:$PATH" goimports-reviser -rm-unused -format ./...
PATH="$HOME/.govm/go/bin:$PATH" CGO_ENABLED=1 CC='gcc -fuse-ld=bfd' go test ./...
PATH="$HOME/.govm/go/bin:$PATH" CGO_ENABLED=1 CC='gcc -fuse-ld=bfd' go test -race ./...
PATH="$HOME/.govm/go/bin:$PATH" CGO_ENABLED=1 CC='gcc -fuse-ld=bfd' golangci-lint run --timeout 5m ./...
```

Expected: all commands exit successfully with zero lint issues.

- [x] **Step 3: Build the Wails application**

```bash
PATH="$HOME/.govm/go/bin:$PATH" CGO_ENABLED=1 CC='gcc -fuse-ld=bfd' wails3 build
```

Expected: frontend and Go application build successfully.

- [x] **Step 4: Clean generated test/build output**

Remove only `frontend/coverage`, `frontend/dist`, `coverage.out`, and `build/bin/mssh` when present. Confirm `git status --short` contains only intended source, generated binding, documentation, and test changes.

- [x] **Step 5: Commit and push by scope**

Use Conventional Commits:

```text
feat(theme): add curated built-in catalog
feat(settings): reset built-in terminal themes
docs(theme): add third-party theme notice
```

Push `main` to its configured upstream and confirm the worktree is clean.
