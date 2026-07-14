# Terminal Theme Follow Interface Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a database-backed switch that lets terminal themes either follow the application Dark/Light mode or remain fixed to an independently selected Profile.

**Architecture:** Extend the existing theme assignment aggregate with follow and fixed-profile fields, persist all four assignment values through `ThemeService`, and resolve the effective terminal Profile through one frontend pure function. The settings editor uses Profile-ID-keyed drafts so shared Dark/Light/Fixed references cannot diverge, while xterm retains ownership of its viewport background.

**Tech Stack:** Go 1.26, SQLite, Wails v3 bindings, React 19, TypeScript, Zustand, shadcn/ui Base Nova, Vitest, Testing Library, xterm.js.

## Global Constraints

- `follow_interface_mode` defaults to `true` for new and existing databases.
- When follow mode is disabled, `fixed_profile_id` must reference an existing terminal Profile.
- Switching application Dark/Light mode must not update terminal state while follow mode is disabled.
- Saving theme configuration must update Profiles and all assignment fields in one database transaction.
- Existing SSH and playback terminals hot-apply the effective Profile only after a successful save or reset.
- Terminal viewport background must be controlled exclusively by xterm `theme.background`.
- Do not add a database table or a runtime dependency.
- Use shadcn/ui semantic tokens and installed Base UI composition patterns.
- Keep functions at 50 lines or fewer, source files at 300 lines or fewer, nesting at three levels or fewer, and cyclomatic complexity at ten or fewer.
- All created directories use `0700`; all created files use `0600` unless executable permission is required.
- Frontend and Go line coverage must remain at or above 90%.
- Run `goimports-reviser`, `golangci-lint`, race tests, frontend coverage, and `wails3 build` before the final push.

---

### Task 1: Persist The Extended Theme Assignment Aggregate

**Files:**
- Modify: `internal/model/theme.go:69`
- Modify: `internal/model/input.go:120`
- Modify: `internal/model/theme_catalog_test.go`
- Modify: `internal/store/theme.go:148`
- Modify: `internal/store/theme_test.go`

**Interfaces:**
- Produces: `model.ThemeAssignments{DarkProfileID int64, LightProfileID int64, FollowInterfaceMode bool, FixedProfileID int64}`
- Produces: `model.ThemeConfigurationInput{Profiles []ThemeProfileInput, Assignments ThemeAssignmentsInput}`
- Produces: `store.GetThemeAssignments` with missing-key defaults of `true` and `0`.
- Produces: store-level Profile deletion rules for Dark, Light, active Fixed, and historical Fixed references.

- [x] **Step 1: Add failing model conversion tests**

Extend `TestThemeCatalogInputConversions` in `internal/model/theme_catalog_test.go`:

```go
input := ThemeAssignmentsInput{
	DarkProfileID:       7,
	LightProfileID:      8,
	FollowInterfaceMode: false,
	FixedProfileID:      9,
}
assert.Equal(t, ThemeAssignments{
	DarkProfileID:       7,
	LightProfileID:      8,
	FollowInterfaceMode: false,
	FixedProfileID:      9,
}, input.ThemeAssignments())
```

- [x] **Step 2: Add failing store assignment tests**

Add table-driven tests in `internal/store/theme_test.go` that cover:

```go
assignments := model.ThemeAssignments{
	DarkProfileID:       4,
	LightProfileID:      7,
	FollowInterfaceMode: false,
	FixedProfileID:      9,
}
require.NoError(t, SaveThemeAssignments(db, assignments))
loaded, err := GetThemeAssignments(db)
require.NoError(t, err)
assert.Equal(t, assignments, loaded)
```

Delete the follow and fixed keys and assert:

```go
loaded, err := GetThemeAssignments(db)
require.NoError(t, err)
assert.True(t, loaded.FollowInterfaceMode)
assert.Zero(t, loaded.FixedProfileID)
```

Insert `not-a-bool` for `terminal.theme.follow_interface_mode` and assert `GetThemeAssignments` returns an error containing the setting key.

Create three Profiles and verify deletion behavior:

```go
// Dark and Light references are always protected.
assert.Error(t, DeleteThemeProfile(db, assignments.DarkProfileID))
assert.Error(t, DeleteThemeProfile(db, assignments.LightProfileID))

// Active fixed reference is protected.
assignments.FollowInterfaceMode = false
require.NoError(t, SaveThemeAssignments(db, assignments))
assert.Error(t, DeleteThemeProfile(db, assignments.FixedProfileID))

// Historical fixed reference is cleared before deletion.
assignments.FollowInterfaceMode = true
require.NoError(t, SaveThemeAssignments(db, assignments))
require.NoError(t, DeleteThemeProfile(db, assignments.FixedProfileID))
loaded, err = GetThemeAssignments(db)
require.NoError(t, err)
assert.Zero(t, loaded.FixedProfileID)
```

- [x] **Step 3: Run focused tests to verify RED**

Run:

```bash
PATH="$HOME/.govm/go/bin:$PATH" go test ./internal/model ./internal/store
```

Expected: FAIL because the new fields, configuration list, boolean persistence, and fixed-reference deletion rules do not exist.

- [x] **Step 4: Extend model inputs and outputs**

Change `internal/model/theme.go`:

```go
type ThemeAssignments struct {
	DarkProfileID       int64 `json:"dark_profile_id"`
	LightProfileID      int64 `json:"light_profile_id"`
	FollowInterfaceMode bool  `json:"follow_interface_mode"`
	FixedProfileID      int64 `json:"fixed_profile_id"`
}
```

Change `internal/model/input.go`:

```go
type ThemeAssignmentsInput struct {
	DarkProfileID       int64 `json:"dark_profile_id"`
	LightProfileID      int64 `json:"light_profile_id"`
	FollowInterfaceMode bool  `json:"follow_interface_mode"`
	FixedProfileID      int64 `json:"fixed_profile_id"`
}

type ThemeConfigurationInput struct {
	Profiles    []ThemeProfileInput   `json:"profiles"`
	Assignments ThemeAssignmentsInput `json:"assignments"`
}

func (input ThemeAssignmentsInput) ThemeAssignments() ThemeAssignments {
	return ThemeAssignments{
		DarkProfileID:       input.DarkProfileID,
		LightProfileID:      input.LightProfileID,
		FollowInterfaceMode: input.FollowInterfaceMode,
		FixedProfileID:      input.FixedProfileID,
	}
}
```

Extend `BuiltinThemeResetResult` with:

```go
FixedReset bool `json:"fixed_reset"`
```

- [x] **Step 5: Implement deterministic assignment persistence**

Add constants in `internal/store/theme.go`:

```go
const (
	darkThemeProfileKey  = "terminal.theme.dark_profile_id"
	lightThemeProfileKey = "terminal.theme.light_profile_id"
	followThemeModeKey   = "terminal.theme.follow_interface_mode"
	fixedThemeProfileKey = "terminal.theme.fixed_profile_id"
)
```

Write numeric settings with `value_type = 'number'` and the follow flag with `value_type = 'boolean'`. Use `strconv.FormatBool` and parse with:

```go
func themeAssignmentBool(db themeDB, key string, defaultValue bool) (bool, error) {
	var value string
	if err := db.QueryRow("SELECT value FROM settings WHERE key = ?", key).Scan(&value); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return defaultValue, nil
		}
		return false, fmt.Errorf("read theme assignment %s: %w", key, err)
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return false, fmt.Errorf("parse theme assignment %s: %w", key, err)
	}
	return parsed, nil
}
```

Return all fields from `GetThemeAssignments`, using `true` and `0` for missing follow and fixed settings.

Update `DeleteThemeProfile` before the delete statement:

```go
if assignments.DarkProfileID == id || assignments.LightProfileID == id {
	return fmt.Errorf("assigned Dark or Light theme profiles cannot be deleted")
}
if assignments.FixedProfileID == id {
	if !assignments.FollowInterfaceMode {
		return fmt.Errorf("the active fixed theme profile cannot be deleted")
	}
	assignments.FixedProfileID = 0
	if err := SaveThemeAssignmentsDB(db, assignments); err != nil {
		return fmt.Errorf("clear historical fixed theme profile: %w", err)
	}
}
```

- [x] **Step 6: Run focused tests to verify GREEN**

Run:

```bash
PATH="$HOME/.govm/go/bin:$PATH" go test ./internal/model ./internal/store
```

Expected: both packages PASS.

- [x] **Step 7: Commit the assignment aggregate**

```bash
git add internal/model/theme.go internal/model/input.go internal/model/theme_catalog_test.go internal/store/theme.go internal/store/theme_test.go
git commit -m "feat(theme): extend theme assignments"
```

### Task 2: Enforce Transactional Theme Configuration Rules

**Files:**
- Modify: `internal/service/theme.go`
- Modify: `internal/service/theme_test.go`
- Modify: `internal/service/theme_builtin.go`
- Modify: `internal/service/theme_builtin_test.go`
- Modify: `internal/store/theme_test.go`

**Interfaces:**
- Consumes: extended `model.ThemeAssignments` and `model.ThemeConfigurationInput` from Task 1.
- Produces: transactional `ThemeService.SaveConfiguration` for a unique Profile list.
- Produces: transactional `ThemeService.DeleteProfile` that safely clears historical Fixed references.
- Produces: initialization repair and deduplicated Dark/Light/Fixed built-in reset.

- [ ] **Step 1: Add failing service validation tests**

Add cases in `internal/service/theme_test.go`:

```go
assert.Error(t, service.SaveAssignments(model.ThemeAssignmentsInput{
	DarkProfileID:       dark.ID,
	LightProfileID:      light.ID,
	FollowInterfaceMode: false,
	FixedProfileID:      0,
}))

assert.Error(t, service.SaveAssignments(model.ThemeAssignmentsInput{
	DarkProfileID:       dark.ID,
	LightProfileID:      light.ID,
	FollowInterfaceMode: false,
	FixedProfileID:      99999,
}))
```

Add a successful fixed assignment and assert `GetAssignments` returns all four fields.

- [ ] **Step 2: Add failing configuration transaction tests**

Create a configuration with three unique Profiles:

```go
input := model.ThemeConfigurationInput{
	Profiles: []model.ThemeProfileInput{
		model.ThemeProfileInputFrom(dark),
		model.ThemeProfileInputFrom(light),
		model.ThemeProfileInputFrom(fixed),
	},
	Assignments: model.ThemeAssignmentsInput{
		DarkProfileID:       dark.ID,
		LightProfileID:      light.ID,
		FollowInterfaceMode: false,
		FixedProfileID:      fixed.ID,
	},
}
require.NoError(t, service.SaveConfiguration(input))
```

Add duplicate Profile IDs to `Profiles` and require an error containing `duplicate theme profile`. Add an invalid Fixed ID after changing a Profile draft and assert neither Profile nor assignments were committed.

- [ ] **Step 3: Add failing initialization and reset tests**

In `internal/service/theme_builtin_test.go`, cover:

```go
// Existing database defaults.
assignments, err := themeService.GetAssignments()
require.NoError(t, err)
assert.True(t, assignments.FollowInterfaceMode)
assert.Zero(t, assignments.FixedProfileID)

// Invalid fixed reference while follow is disabled repairs to Dark.
assignments.FollowInterfaceMode = false
assignments.FixedProfileID = 99999
require.NoError(t, store.SaveThemeAssignments(db, assignments))
require.NoError(t, themeService.InitializeDefaults())
repaired, err := themeService.GetAssignments()
require.NoError(t, err)
assert.Equal(t, repaired.DarkProfileID, repaired.FixedProfileID)
```

Assign a third built-in Profile as Fixed while follow is disabled, customize all three assigned Profiles, reset, and assert `DarkReset`, `LightReset`, and `FixedReset` are true. Assign the same Profile to Dark and Fixed and assert its update occurs once while both result fields remain true.

- [ ] **Step 4: Run service tests to verify RED**

Run:

```bash
PATH="$HOME/.govm/go/bin:$PATH" go test ./internal/service ./internal/store
```

Expected: FAIL because configuration still accepts two fixed fields, fixed assignment validation is absent, and reset does not include Fixed.

- [ ] **Step 5: Implement assignment validation**

Add a helper in `internal/service/theme.go`:

```go
func validateThemeAssignments(db interface {
	Exec(query string, args ...any) (sql.Result, error)
	Query(query string, args ...any) (*sql.Rows, error)
	QueryRow(query string, args ...any) *sql.Row
}, assignments model.ThemeAssignments) error {
	checks := []struct {
		label string
		id    int64
	}{
		{label: "dark", id: assignments.DarkProfileID},
		{label: "light", id: assignments.LightProfileID},
	}
	if !assignments.FollowInterfaceMode {
		if assignments.FixedProfileID < 1 {
			return fmt.Errorf("fixed theme profile is required when follow mode is disabled")
		}
		checks = append(checks, struct {
			label string
			id    int64
		}{label: "fixed", id: assignments.FixedProfileID})
	}
	for _, check := range checks {
		if _, err := store.GetThemeProfile(db, check.id); err != nil {
			return fmt.Errorf("%s theme profile: %w", check.label, err)
		}
	}
	return nil
}
```

Call it from `SaveAssignments` before persistence.

- [ ] **Step 6: Refactor SaveConfiguration to a unique Profile list**

Validate input before opening the transaction:

```go
profiles := make([]model.ThemeProfile, 0, len(input.Profiles))
seen := make(map[int64]struct{}, len(input.Profiles))
for _, profileInput := range input.Profiles {
	profile := profileInput.ThemeProfile()
	if _, duplicate := seen[profile.ID]; duplicate {
		return fmt.Errorf("duplicate theme profile %d", profile.ID)
	}
	if err := validateThemeProfile(profile); err != nil {
		return fmt.Errorf("theme profile %d: %w", profile.ID, err)
	}
	seen[profile.ID] = struct{}{}
	profiles = append(profiles, profile)
}
```

Inside one transaction, validate assignment references, update each Profile once, save assignments, and commit. Roll back and wrap every failure with `save theme configuration`.

- [ ] **Step 7: Make Profile deletion transactional**

Change `ThemeService.DeleteProfile` to begin a transaction, call `store.DeleteThemeProfile(tx, id)`, roll back on error, and commit on success. This makes historical Fixed clearing and Profile deletion atomic.

- [ ] **Step 8: Repair follow and fixed assignments during initialization**

Extend `repairThemeAssignments`:

```go
if _, valid := state.profileIDs[assignments.FixedProfileID]; !valid {
	if assignments.FollowInterfaceMode {
		assignments.FixedProfileID = 0
	} else {
		assignments.FixedProfileID = assignments.DarkProfileID
	}
}
```

Because missing follow settings load as `true`, saving the repaired assignments writes the explicit default for future reads.

- [ ] **Step 9: Deduplicate built-in reset work**

Use a cache keyed by Profile ID:

```go
resetByID := make(map[int64]bool, 3)
reset := func(id int64) (bool, error) {
	if value, exists := resetByID[id]; exists {
		return value, nil
	}
	value, err := resetBuiltinProfile(tx, id)
	if err != nil {
		return false, err
	}
	resetByID[id] = value
	return value, nil
}
```

Reset Dark and Light unconditionally. Reset Fixed only when follow mode is disabled. Populate all three result fields from the cached results.

- [ ] **Step 10: Run service tests to verify GREEN**

Run:

```bash
PATH="$HOME/.govm/go/bin:$PATH" go test ./internal/service ./internal/store
```

Expected: both packages PASS.

- [ ] **Step 11: Commit transactional behavior**

```bash
git add internal/service/theme.go internal/service/theme_test.go internal/service/theme_builtin.go internal/service/theme_builtin_test.go internal/store/theme_test.go
git commit -m "feat(theme): enforce follow mode rules"
```

### Task 3: Generate Bindings And Centralize Effective Profile Resolution

**Files:**
- Modify: `frontend/bindings/github.com/xuthus5/mssh/internal/model/index.ts`
- Modify: `frontend/bindings/github.com/xuthus5/mssh/internal/model/models.ts`
- Modify: `frontend/bindings/github.com/xuthus5/mssh/internal/service/themeservice.ts`
- Create: `frontend/src/lib/effectiveTerminalTheme.ts`
- Create: `frontend/src/lib/effectiveTerminalTheme.test.ts`
- Modify: `frontend/src/hooks/useThemeCatalog.ts`
- Modify: `frontend/src/hooks/useThemeCatalog.test.tsx`

**Interfaces:**
- Consumes: generated four-field `ThemeAssignments`, list-based `ThemeConfigurationInput`, and `BuiltinThemeResetResult.fixed_reset`.
- Produces: `effectiveTerminalProfileID(assignments, colorMode) number`.
- Produces: `resolveEffectiveTerminalProfile(assignments, colorMode, profiles) ThemeProfile`.
- Produces: interface mode switching that skips terminal updates when follow mode is disabled.

- [ ] **Step 1: Generate Wails bindings**

Run:

```bash
PATH="$HOME/.govm/go/bin:$PATH" wails3 generate bindings -ts -names -d frontend/bindings/ .
```

Verify generated TypeScript contains:

```ts
follow_interface_mode: boolean
fixed_profile_id: number
profiles: ThemeProfileInput[]
fixed_reset: boolean
```

- [ ] **Step 2: Add failing resolver tests**

Create `frontend/src/lib/effectiveTerminalTheme.test.ts`:

```ts
it.each([
  ['dark', true, 1],
  ['light', true, 2],
  ['dark', false, 3],
  ['light', false, 3],
] as const)('resolves %s mode with follow=%s', (mode, follow, expected) => {
  expect(effectiveTerminalProfileID({
    dark_profile_id: 1,
    light_profile_id: 2,
    follow_interface_mode: follow,
    fixed_profile_id: 3,
  } as never, mode)).toBe(expected)
})
```

Add a missing Profile case and assert `resolveEffectiveTerminalProfile` throws `terminal theme profile <id> is unavailable`.

- [ ] **Step 3: Add failing catalog hook tests**

Extend `frontend/src/hooks/useThemeCatalog.test.tsx` with two tests:

```ts
it('does not update terminal theme when interface mode changes with follow disabled', async () => {
  registerCatalogHandlers('dark', { follow_interface_mode: false, fixed_profile_id: 3 })
  renderHook(() => useThemeCatalog())
  await waitFor(() => expect(useThemeCatalogStore.getState().loaded).toBe(true))
  const before = useAppStore.getState().terminalTheme
  await act(async () => { await changeColorMode('light') })
  expect(useAppStore.getState().terminalTheme).toBe(before)
  expect(document.documentElement).toHaveClass('light')
})
```

Add the follow-enabled counterpart and assert the terminal background changes from the assigned Dark Profile to the assigned Light Profile.

- [ ] **Step 4: Run frontend tests to verify RED**

Run:

```bash
cd frontend && npm test -- src/lib/effectiveTerminalTheme.test.ts src/hooks/useThemeCatalog.test.tsx
```

Expected: FAIL because the resolver does not exist and `changeColorMode` always applies a terminal Profile.

- [ ] **Step 5: Implement the pure resolver**

Create `frontend/src/lib/effectiveTerminalTheme.ts`:

```ts
import type { ThemeAssignments, ThemeProfile } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'

export type ColorMode = 'dark' | 'light'

export function effectiveTerminalProfileID(assignments: ThemeAssignments, colorMode: ColorMode): number {
  if (!assignments.follow_interface_mode) return assignments.fixed_profile_id
  return colorMode === 'dark' ? assignments.dark_profile_id : assignments.light_profile_id
}

export function resolveEffectiveTerminalProfile(assignments: ThemeAssignments, colorMode: ColorMode, profiles: ThemeProfile[]): ThemeProfile {
  const profileID = effectiveTerminalProfileID(assignments, colorMode)
  const profile = profiles.find((item) => item.id === profileID)
  if (!profile) throw new Error(`terminal theme profile ${profileID} is unavailable`)
  return profile
}
```

Remove the `ColorMode` declaration from `useThemeCatalog.ts` and import this exported type there, so the pure resolver never depends on a React hook module.

- [ ] **Step 6: Separate interface mode and terminal theme application**

Refactor `useThemeCatalog.ts` into focused helpers:

```ts
function applyInterfaceColorMode(mode: ColorMode) {
  document.documentElement.classList.toggle('light', mode === 'light')
  localStorage.setItem('mssh:color-mode', mode)
  useThemeCatalogStore.setState({ colorMode: mode })
}

function applyEffectiveTerminalTheme() {
  const state = useThemeCatalogStore.getState()
  const profile = resolveEffectiveTerminalProfile(state.assignments, state.colorMode, state.profiles)
  useAppStore.getState().setTerminalTheme(profileToTerminalTheme(profile))
}
```

On initial load, call both helpers. In `changeColorMode`, call `applyInterfaceColorMode(nextMode)` and only call `applyEffectiveTerminalTheme()` when `assignments.follow_interface_mode` is true. On persistence failure restore the previous interface mode and restore the terminal theme only when follow mode is enabled.

Initialize the Zustand state with:

```ts
assignments: {
  dark_profile_id: 0,
  light_profile_id: 0,
  follow_interface_mode: true,
  fixed_profile_id: 0,
} as ThemeAssignments
```

After successful configuration save, reset, deletion, or startup reload, apply the effective Profile exactly once.

- [ ] **Step 7: Run frontend tests to verify GREEN**

Run:

```bash
cd frontend && npm test -- src/lib/effectiveTerminalTheme.test.ts src/hooks/useThemeCatalog.test.tsx
```

Expected: both test files PASS.

- [ ] **Step 8: Commit bindings and resolver**

```bash
git add frontend/bindings frontend/src/lib/effectiveTerminalTheme.ts frontend/src/lib/effectiveTerminalTheme.test.ts frontend/src/hooks/useThemeCatalog.ts frontend/src/hooks/useThemeCatalog.test.tsx
git commit -m "feat(theme): resolve effective terminal theme"
```

### Task 4: Build The Follow Mode Settings Experience

**Files:**
- Create: `frontend/src/components/ui/switch.tsx`
- Create: `frontend/src/components/settings/themeEditorState.ts`
- Create: `frontend/src/components/settings/themeEditorState.test.ts`
- Modify: `frontend/src/components/settings/ThemeModeSelector.tsx`
- Modify: `frontend/src/components/settings/ThemeModeSelector.test.tsx`
- Modify: `frontend/src/components/settings/ThemeEditor.tsx`
- Modify: `frontend/src/components/settings/ThemeEditor.test.tsx`
- Modify: `frontend/src/components/settings/SettingsDialog.tsx`
- Modify: `frontend/src/components/settings/SettingsDialog.test.tsx`
- Modify: `frontend/src/components/layout/Sidebar.tsx`

**Interfaces:**
- Consumes: `ColorMode`, four-field assignments, Profile list configuration, and fixed reset result.
- Produces: Profile-ID-keyed terminal theme drafts.
- Produces: a `ThemeModeSelector` fixed mode that lists all Profiles.
- Produces: shadcn Switch interaction with current-mode initialization and persisted fixed-profile reuse.

- [ ] **Step 1: Preview and add the shadcn Switch**

Run inside `frontend`:

```bash
npx shadcn@latest add switch --dry-run
npx shadcn@latest add switch
```

Verify the generated component uses the Base UI API configured by `components.json`, imports `cn` from `@/lib/utils`, and does not add raw color classes.

- [ ] **Step 2: Add failing editor-state tests**

Create `frontend/src/components/settings/themeEditorState.test.ts` covering Profile-ID-keyed drafts:

```ts
const drafts = createThemeDrafts(profiles)
expect(drafts.get(1)?.background).toBe('#111111')

const configuration = buildThemeConfiguration(profiles, drafts, {
  dark_profile_id: 1,
  light_profile_id: 2,
  follow_interface_mode: false,
  fixed_profile_id: 1,
} as never)
expect(configuration.profiles.map((profile) => profile.id)).toEqual([1, 2])
```

Add a missing draft case that throws a precise error instead of emitting a partial configuration.

- [ ] **Step 3: Add failing selector tests**

Extend `ThemeModeSelector.test.tsx`:

```ts
render(<ThemeModeSelector mode="fixed" profiles={catalog as never} value={3} onValueChange={onChange} />)
await user.click(screen.getByRole('combobox', { name: '固定终端主题' }))
expect(screen.getByText('Dark custom')).toBeInTheDocument()
expect(screen.getByText('Light imported')).toBeInTheDocument()
expect(screen.getByText('Universal shared')).toBeInTheDocument()
```

Assert each result contains a mode Badge, source Badge, and color preview with a background swatch derived from `definition.color_payload`.

- [ ] **Step 4: Add failing ThemeEditor interaction tests**

Add tests in `ThemeEditor.test.tsx` for:

```ts
expect(screen.getByRole('switch', { name: '跟随界面模式' })).toBeChecked()
```

Turn the switch off with `colorMode="light"` and `fixed_profile_id = 0`; assert the fixed selector chooses `light_profile_id`. Save and assert:

```ts
expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
  assignments: expect.objectContaining({
    follow_interface_mode: false,
    fixed_profile_id: 2,
  }),
  profiles: expect.arrayContaining([
    expect.objectContaining({ id: 1 }),
    expect.objectContaining({ id: 2 }),
  ]),
}))
```

Re-render with a persisted fixed Profile, enable follow, disable it again, and assert the previous fixed ID remains selected. Add mismatch Alert and shared Profile Badge assertions. Extend reset tests to cover `fixed_reset` messages and fixed built-in eligibility only while persisted follow mode is disabled.

- [ ] **Step 5: Run component tests to verify RED**

Run:

```bash
cd frontend && npm test -- src/components/settings/themeEditorState.test.ts src/components/settings/ThemeModeSelector.test.tsx src/components/settings/ThemeEditor.test.tsx src/components/settings/SettingsDialog.test.tsx
```

Expected: FAIL because fixed selection, Switch behavior, Profile-ID-keyed drafts, and color-mode props are absent.

- [ ] **Step 6: Implement Profile-ID-keyed editor state**

Create `themeEditorState.ts` with these exports:

```ts
export type ThemeEditorSlot = 'dark' | 'light' | 'fixed'
export type ThemeDraftMap = Map<number, TerminalTheme>

export function createThemeDrafts(profiles: ThemeProfile[]): ThemeDraftMap
export function profileIDForSlot(slot: ThemeEditorSlot, assignments: ThemeAssignments): number
export function buildThemeConfiguration(
  profiles: ThemeProfile[],
  drafts: ThemeDraftMap,
  assignments: ThemeAssignments,
): ThemeConfigurationInput
```

`buildThemeConfiguration` collects Dark and Light IDs and adds Fixed only while follow mode is disabled. Use a `Set<number>` so shared references produce one `ThemeProfileInput`.

- [ ] **Step 7: Extend ThemeModeSelector for fixed mode**

Change the mode type:

```ts
type SelectorMode = 'dark' | 'light' | 'fixed'
```

Filter only Dark and Light modes; fixed mode uses all Profiles. Labels are:

```ts
const label = mode === 'dark'
  ? 'Dark Mode 终端主题'
  : mode === 'light'
    ? 'Light Mode 终端主题'
    : '固定终端主题'
```

Parse `definition.color_payload` defensively and display `[background, ansi[1], ansi[2], ansi[4]]` as small bordered swatches before the name. Invalid payloads render no swatches and do not break selection.

- [ ] **Step 8: Implement the strategy Card and dynamic editor context**

Add `colorMode: ColorMode` to `ThemeEditor` props and pass it through `SettingsDialog` and `Sidebar`.

Use a shadcn `Field` with Switch:

```tsx
<Field orientation="horizontal">
  <FieldContent>
    <FieldLabel htmlFor="terminal-follow-interface-mode">跟随界面模式</FieldLabel>
    <FieldDescription>切换 Dark/Light 时，自动使用对应的终端主题。</FieldDescription>
  </FieldContent>
  <Switch
    id="terminal-follow-interface-mode"
    checked={draftAssignments.follow_interface_mode}
    disabled={saving}
    onCheckedChange={setFollowInterfaceMode}
  />
</Field>
```

When disabling follow mode:

```ts
const fixedProfileID = current.fixed_profile_id || (
  colorMode === 'dark' ? current.dark_profile_id : current.light_profile_id
)
```

Set the editor slot to `fixed`. When enabling follow mode, preserve `fixed_profile_id` and set the editor slot to the current `colorMode`.

Follow mode renders two mode selectors and Dark/Light Tabs. Fixed mode renders one fixed selector and no Tabs. The active draft is selected by Profile ID, so shared references edit one object.

- [ ] **Step 9: Add mismatch, sharing, save, and reset feedback**

Render a neutral shadcn `Alert` when the fixed Profile definition mode is neither `universal` nor the current interface mode. Render secondary Badges for `同时用于 Dark Mode` and `同时用于 Light Mode` as applicable.

Build the save payload with `buildThemeConfiguration`. Disable all strategy controls while saving. Keep reset disabled when `dirty` is true. Compute reset copy from slot labels:

```ts
function resetResultMessage(result: BuiltinThemeResetResult): string {
  const labels = [
    result.dark_reset ? 'Dark' : null,
    result.light_reset ? 'Light' : null,
    result.fixed_reset ? '固定' : null,
  ].filter((label): label is string => label !== null)
  return labels.length > 0
    ? `已重置 ${labels.join('、')} 内置主题`
    : '当前绑定没有可重置的内置主题'
}
```

Compute reset eligibility from persisted assignments:

```ts
const persistedIDs = [assignments.dark_profile_id, assignments.light_profile_id]
if (!assignments.follow_interface_mode) persistedIDs.push(assignments.fixed_profile_id)
const canReset = persistedIDs.some((id) => findProfile(profiles, id)?.definition?.is_builtin === true)
```

- [ ] **Step 10: Run component tests to verify GREEN**

Run:

```bash
cd frontend && npm test -- src/components/settings/themeEditorState.test.ts src/components/settings/ThemeModeSelector.test.tsx src/components/settings/ThemeEditor.test.tsx src/components/settings/SettingsDialog.test.tsx
```

Expected: all targeted component tests PASS.

- [ ] **Step 11: Commit the settings experience**

```bash
git add frontend/src/components/ui/switch.tsx frontend/src/components/settings/themeEditorState.ts frontend/src/components/settings/themeEditorState.test.ts frontend/src/components/settings/ThemeModeSelector.tsx frontend/src/components/settings/ThemeModeSelector.test.tsx frontend/src/components/settings/ThemeEditor.tsx frontend/src/components/settings/ThemeEditor.test.tsx frontend/src/components/settings/SettingsDialog.tsx frontend/src/components/settings/SettingsDialog.test.tsx frontend/src/components/layout/Sidebar.tsx
git commit -m "feat(theme): add follow mode controls"
```

### Task 5: Restore xterm Background Ownership And Close Integration Gaps

**Files:**
- Modify: `frontend/src/styles/globals.css:162`
- Create: `frontend/src/styles/globals.test.ts`
- Modify: `frontend/src/hooks/useTerminal.test.tsx`
- Modify: `frontend/src/components/terminal/PlaybackTab.test.tsx`
- Modify: `frontend/vite.config.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: effective global terminal theme updates from Task 3.
- Produces: no global CSS override for `.xterm-viewport` background.
- Produces: regression coverage for SSH and playback hot updates with a fixed custom background.

- [ ] **Step 1: Add the failing CSS ownership test**

Create `frontend/src/styles/globals.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import styles from '@/styles/globals.css?raw'

describe('terminal viewport styling', () => {
  it('does not override xterm theme backgrounds with the application background token', () => {
    expect(styles).not.toMatch(/\.xterm\s+\.xterm-viewport\s*\{[^}]*--background[^}]*!important[^}]*\}/s)
  })
})
```

Run:

```bash
cd frontend && npm test -- src/styles/globals.test.ts
```

Expected: FAIL because the forbidden rule still exists.

- [ ] **Step 2: Add SSH and playback integration assertions**

Extend `useTerminal.test.tsx` so a global theme update to `background: '#123456'` updates the existing terminal options exactly once.

Extend `PlaybackTab.test.tsx` with the same fixed background and assert the playback terminal receives:

```ts
expect(terminalInstances[0].options.theme).toEqual(expect.objectContaining({
  background: '#123456',
}))
```

These tests protect both live terminal types from diverging after the new resolver is introduced.

- [ ] **Step 3: Remove the CSS override**

Delete only:

```css
.xterm .xterm-viewport {
  background-color: var(--background) !important;
}
```

Keep the global scrollbar token rules unchanged.

- [ ] **Step 4: Include new files in frontend coverage**

Update `frontend/vite.config.ts` coverage includes so `effectiveTerminalTheme.ts`, `themeEditorState.ts`, and the modified settings components participate in the 90% gate.

- [ ] **Step 5: Update README behavior summary**

Change the terminal theme feature line to state that users can either bind separate Dark/Light Profiles or choose one fixed terminal Profile independent of the application mode.

- [ ] **Step 6: Run focused integration tests**

Run:

```bash
cd frontend && npm test -- src/styles/globals.test.ts src/hooks/useTerminal.test.tsx src/components/terminal/PlaybackTab.test.tsx
```

Expected: all targeted tests PASS.

- [ ] **Step 7: Commit the xterm ownership fix**

```bash
git add frontend/src/styles/globals.css frontend/src/styles/globals.test.ts frontend/src/hooks/useTerminal.test.tsx frontend/src/components/terminal/PlaybackTab.test.tsx frontend/vite.config.ts README.md
git commit -m "fix(theme): preserve terminal backgrounds"
```

### Task 6: Full Verification, Review, And Delivery

**Files:**
- Modify: `docs/superpowers/plans/2026-07-14-terminal-theme-follow-interface-mode.md`

**Interfaces:**
- Consumes: all implementation tasks.
- Produces: verified, reviewed, committed, and pushed `main` branch with no generated artifacts.

- [ ] **Step 1: Run frontend coverage**

```bash
cd frontend && npm run test:coverage
```

Expected: all tests PASS and line coverage is at least 90%.

- [ ] **Step 2: Run Go formatting and tests**

```bash
export PATH="$HOME/.govm/go/bin:$HOME/go/bin:$PATH"
goimports-reviser -project-name github.com/xuthus5/mssh -rm-unused -set-alias -format ./...
go test ./...
go test -race -coverprofile=coverage.out -covermode=atomic -coverpkg=./internal/...,./pkg/... ./internal/... ./pkg/...
go tool cover -func=coverage.out | tail -1
```

Expected: tests PASS, race detection reports no races, and total Go coverage is at least 90%.

- [ ] **Step 3: Run lint and production build**

```bash
export PATH="$HOME/.govm/go/bin:$HOME/go/bin:$PATH"
CGO_ENABLED=1 CC='gcc -fuse-ld=bfd' golangci-lint run --timeout 5m ./...
CGO_ENABLED=1 CC='gcc -fuse-ld=bfd' wails3 build
```

Expected: `0 issues` and successful Wails build. The existing Vite chunk-size warning is non-blocking.

- [ ] **Step 4: Request code review and close findings**

Use `requesting-code-review` against the complete diff. Reject any implementation that:

- updates terminal state while follow mode is disabled,
- permits deleting the active fixed Profile,
- performs non-transactional assignment/profile saves,
- reintroduces an xterm viewport background override,
- leaves generated bindings inconsistent with Go models.

Fix every Critical or Important finding, then rerun the affected focused tests.

- [ ] **Step 5: Clean generated outputs**

```bash
rm -rf frontend/coverage frontend/dist
rm -f coverage.out build/bin/mssh
git diff --check
git status --short
```

Expected: no coverage or build artifacts remain; only intended source, test, generated binding, documentation, and plan changes are present.

- [ ] **Step 6: Close the plan checklist**

Mark every completed checkbox in this file with `[x]`, then run:

```bash
git diff --check
```

Expected: no whitespace errors and no unchecked implementation steps.

- [ ] **Step 7: Commit plan closure and push**

```bash
git add docs/superpowers/plans/2026-07-14-terminal-theme-follow-interface-mode.md
git commit -m "docs(theme): close follow mode plan"
git push origin main
git status --short --branch
```

Expected: `main` matches `origin/main` and the working tree is clean.
