# Global Terminal Style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persisted global terminal font, size, and cursor style settings that every terminal theme follows by default, while allowing each Profile to retain and activate independent overrides.

**Architecture:** Extend `terminal_theme_profiles` with a persisted `follow_global_style` flag and store the three global values in the existing typed `settings` table. `ThemeService` owns initialization, validation, and atomic configuration saves. The React theme catalog loads the global style beside Profiles and Assignments, then a single pure resolver combines Profile colors with either global or Profile-level typography before writing `appStore.terminalTheme`.

**Tech Stack:** Go 1.26, SQLite, Wails v3 bindings, React 19, TypeScript, Zustand, xterm.js, shadcn/ui Base Nova, Vitest, Testing Library, testify.

## Global Constraints

- Global style contains only terminal font family, font size, and cursor style; cursor color remains Profile-owned.
- Global font size and Profile fallback font size must remain in the inclusive range `8–48`.
- Cursor style accepts only `block`, `underline`, or `bar`.
- Theme catalog schemas that do not match the final POC format are dropped and rebuilt; no historical Profile data migration is implemented.
- New built-in, imported, and custom Profiles default to following global style.
- Configuration save must atomically persist global style, Profile drafts, and theme Assignments.
- Unsaved drafts affect only the settings preview; open terminals update only after a successful save and catalog reload.
- Existing SSH, split, and playback terminals must hot-apply the effective style without reconnecting.
- New directories and files use repository-required permissions; generated build and coverage artifacts are removed before commit.

---

### Task 1: Persist Global Style And Profile Follow State

**Files:**
- Modify: `internal/model/theme.go`
- Modify: `internal/model/input.go`
- Modify: `internal/model/input_test.go`
- Modify: `internal/store/theme_schema.go`
- Modify: `internal/store/theme.go`
- Create: `internal/store/terminal_style.go`
- Create: `internal/store/terminal_style_test.go`
- Modify: `internal/store/theme_test.go`
- Modify: `internal/store/db_test.go`

**Interfaces:**
- Produces: `model.TerminalGlobalStyle`
- Produces: `model.TerminalGlobalStyleInput`
- Produces: `ThemeProfile.FollowGlobalStyle bool`
- Produces: `ThemeProfileInput.FollowGlobalStyle bool`
- Produces: `store.GetTerminalGlobalStyle(themeDB) (model.TerminalGlobalStyle, error)`
- Produces: `store.SaveTerminalGlobalStyleDB(themeDB, model.TerminalGlobalStyle) error`

- [ ] **Step 1: Write failing model and schema tests**

Add assertions that input conversion preserves global style and Profile follow state:

```go
func TestTerminalGlobalStyleInputConversions(t *testing.T) {
	input := TerminalGlobalStyleInput{FontFamily: "JetBrains Mono", FontSize: 16, CursorStyle: CursorStyleBlock}
	assert.Equal(t, TerminalGlobalStyle(input), input.TerminalGlobalStyle())
	assert.Equal(t, input, TerminalGlobalStyleInputFrom(input.TerminalGlobalStyle()))

	profile := ThemeProfile{ID: 7, FollowGlobalStyle: true, FontFamily: "mono", FontSize: 14, CursorStyle: CursorStyleBar}
	assert.True(t, ThemeProfileInputFrom(profile).FollowGlobalStyle)
}
```

Extend database tests so a fresh database exposes:

```text
follow_global_style INTEGER NOT NULL DEFAULT 1
```

Add a stale-schema test that creates a Profile table without `follow_global_style`, inserts historical data, runs `Migrate`, and asserts the theme catalog was rebuilt in the final format and the historical Profile no longer exists.

- [ ] **Step 2: Run model and schema tests to verify RED**

Run:

```bash
PATH="$HOME/.govm/go/bin:$PATH" go test ./internal/model ./internal/store -run 'TestTerminalGlobalStyle|TestMigrate|TestTheme' -count=1
```

Expected: FAIL because the global model, input fields, schema column, and store functions do not exist.

- [ ] **Step 3: Add model and input types**

Add to `internal/model/theme.go`:

```go
const (
	DefaultTerminalFontFamily = `"JetBrains Mono", "Cascadia Code", monospace`
	DefaultTerminalFontSize   = 14
)

type TerminalGlobalStyle struct {
	FontFamily  string      `json:"font_family"`
	FontSize    int         `json:"font_size"`
	CursorStyle CursorStyle `json:"cursor_style"`
}
```

Add `FollowGlobalStyle bool` to `ThemeProfile`. Add the corresponding input type, conversion methods, and `ThemeConfigurationInput.GlobalStyle` in `internal/model/input.go`:

```go
type TerminalGlobalStyleInput struct {
	FontFamily  string      `json:"font_family"`
	FontSize    int         `json:"font_size"`
	CursorStyle CursorStyle `json:"cursor_style"`
}

func (input TerminalGlobalStyleInput) TerminalGlobalStyle() TerminalGlobalStyle {
	return TerminalGlobalStyle(input)
}

func TerminalGlobalStyleInputFrom(style TerminalGlobalStyle) TerminalGlobalStyleInput {
	return TerminalGlobalStyleInput(style)
}
```

- [ ] **Step 4: Enforce the final POC Profile schema**

Add `follow_global_style INTEGER NOT NULL DEFAULT 1` to `themeProfilesSchema`. Extend the theme catalog schema-current check to inspect both `themes` and `terminal_theme_profiles`. The final check must require the new Profile column:

```go
func themeProfileSchemaCurrent(db *sql.DB) (bool, error) {
	columns, err := tableColumns(db, "terminal_theme_profiles")
	if err != nil {
		return false, fmt.Errorf("inspect terminal theme profiles: %w", err)
	}
	return columns["theme_id"] &&
		columns["follow_global_style"] &&
		columns["font_family"] &&
		columns["font_size"] &&
		columns["cursor_style"] &&
		columns["color_overrides"], nil
}
```

If either theme definitions or Profile schema is not current, call the existing schema replacement path and recreate both tables. Do not add `ALTER TABLE`, data-copy, compatibility branches, or legacy value conversion.

- [ ] **Step 5: Update Profile CRUD and scanning**

Include `follow_global_style` in Profile INSERT, SELECT, UPDATE, and scan order. SQLite bool values scan directly into `bool`:

```go
INSERT INTO terminal_theme_profiles
  (name, theme_id, follow_global_style, font_family, font_size, cursor_style, color_overrides)
VALUES (?, ?, ?, ?, ?, ?, ?)
```

Ensure `themeProfileSelect` and `scanThemeProfile` use the exact same field order.

- [ ] **Step 6: Implement typed global style storage**

Create `internal/store/terminal_style.go` with keys:

```go
const (
	terminalFontFamilyKey  = "terminal.style.font_family"
	terminalFontSizeKey    = "terminal.style.font_size"
	terminalCursorStyleKey = "terminal.style.cursor_style"
)
```

Implement reads where missing keys use the documented field defaults while malformed persisted values return contextual errors, plus transaction-compatible writes using the existing `themeDB` interface. Persist JSON-compatible values with namespace `terminal`, version `1`, and matching value types.

`GetTerminalGlobalStyle` returns a contextual error for malformed persisted data; default repair belongs to the service initialization task rather than silently masking corruption in the store.

- [ ] **Step 7: Run store tests to verify GREEN**

Run:

```bash
PATH="$HOME/.govm/go/bin:$PATH" go test ./internal/model ./internal/store -count=1
```

Expected: PASS, including fresh schema, stale-schema replacement, Profile round trips, global style round trips, missing-key behavior, and malformed setting errors.

- [ ] **Step 8: Commit persistence layer**

```bash
git add internal/model internal/store
git commit -m "feat(theme): persist global terminal style"
git push origin main
```

---

### Task 2: Add Transactional Theme Service Behavior

**Files:**
- Create: `internal/service/terminal_style.go`
- Create: `internal/service/terminal_style_test.go`
- Modify: `internal/service/theme.go`
- Modify: `internal/service/theme_test.go`
- Modify: `internal/service/theme_builtin.go`
- Modify: `internal/service/theme_builtin_test.go`
- Modify: `internal/service/theme_import.go`
- Modify: `internal/service/theme_import_test.go`

**Interfaces:**
- Consumes: `store.GetTerminalGlobalStyle`
- Consumes: `store.SaveTerminalGlobalStyleDB`
- Produces: `ThemeService.GetGlobalStyle() (model.TerminalGlobalStyle, error)`
- Produces: transactional `ThemeService.SaveConfiguration(model.ThemeConfigurationInput) error`

- [ ] **Step 1: Write failing service tests**

Cover these behaviors:

```go
func TestThemeServiceInitializesDefaultGlobalStyle(t *testing.T)
func TestThemeServiceRepairsMalformedGlobalStyle(t *testing.T)
func TestThemeServiceRejectsInvalidGlobalAndFallbackStyles(t *testing.T)
func TestThemeServiceSavesGlobalStyleProfilesAndAssignmentsAtomically(t *testing.T)
func TestThemeServiceRollsBackWhenGlobalStyleWriteFails(t *testing.T)
func TestBuiltinResetRestoresFollowGlobalWithoutChangingGlobalStyle(t *testing.T)
func TestImportedAndCustomProfilesFollowGlobalByDefault(t *testing.T)
```

The rollback test creates a SQLite trigger on `terminal.style.font_size`, submits valid Profile and Assignment changes, forces the global style write to fail, then asserts every persisted value remains unchanged.

- [ ] **Step 2: Run service tests to verify RED**

Run:

```bash
PATH="$HOME/.govm/go/bin:$PATH" go test ./internal/service -run 'TestThemeService|TestBuiltin|TestImported' -count=1
```

Expected: FAIL because service initialization, validation, reset, import defaults, and atomic global writes are incomplete.

- [ ] **Step 3: Implement normalization and validation helpers**

Create `internal/service/terminal_style.go`:

```go
func defaultTerminalGlobalStyle() model.TerminalGlobalStyle {
	return model.TerminalGlobalStyle{
		FontFamily: model.DefaultTerminalFontFamily,
		FontSize: model.DefaultTerminalFontSize,
		CursorStyle: model.CursorStyleBar,
	}
}

func validateTerminalStyle(fontFamily string, fontSize int, cursorStyle model.CursorStyle) error
func validateTerminalGlobalStyle(style model.TerminalGlobalStyle) error
func normalizeTerminalFontFamily(fontFamily string) string
```

Normalization removes control characters, trims whitespace, and limits the persisted value to `256` runes. Validation rejects empty results, out-of-range sizes, and unknown cursor styles. `validateThemeProfile` must call the same shared validator even when `FollowGlobalStyle` is true so dormant values remain safe.

- [ ] **Step 4: Initialize and expose global style**

During `ThemeService.InitializeDefaults`, repair global style in the existing initialization transaction:

```go
func repairTerminalGlobalStyle(tx *sql.Tx) error {
	style, err := store.GetTerminalGlobalStyle(tx)
	if err != nil {
		style = defaultTerminalGlobalStyle()
	}
	if validateErr := validateTerminalGlobalStyle(style); validateErr != nil {
		style = defaultTerminalGlobalStyle()
	}
	return store.SaveTerminalGlobalStyleDB(tx, style)
}
```

Expose `GetGlobalStyle`, calling `InitializeDefaults` before reading.

- [ ] **Step 5: Extend atomic SaveConfiguration**

Convert `input.GlobalStyle`, validate it before opening the transaction, then save in this order:

```text
validate Assignments references
update unique Profiles
save global style
save Assignments
commit
```

Return `%w`-wrapped errors with `save theme configuration` context. Do not update any global style through a separate `SettingService` frontend call.

- [ ] **Step 6: Apply default follow behavior**

Set `FollowGlobalStyle: true` in:

- `defaultBuiltinProfile`
- imported Profile creation
- custom Profile creation when `ThemeProfileInput.ID == 0` and the caller omitted the field

Because Go bool has no “omitted” distinction, custom creation must explicitly normalize new Profiles to `true`; updates preserve the supplied value.

- [ ] **Step 7: Update built-in reset semantics**

`resetBuiltinProfile` must restore:

```go
profile.FollowGlobalStyle = true
profile.FontFamily = model.DefaultTerminalFontFamily
profile.FontSize = model.DefaultTerminalFontSize
profile.CursorStyle = model.CursorStyleBar
profile.ColorOverrides = `{}`
```

Global style settings must not be written by reset.

- [ ] **Step 8: Run service tests to verify GREEN**

Run:

```bash
PATH="$HOME/.govm/go/bin:$PATH" go test ./internal/service -count=1
PATH="$HOME/.govm/go/bin:$PATH" go test -race ./internal/service -count=1
```

Expected: PASS with atomic rollback, default repair, reset, custom, and import behavior covered.

- [ ] **Step 9: Commit service layer**

```bash
git add internal/service
git commit -m "feat(theme): apply global style transactionally"
git push origin main
```

---

### Task 3: Generate Bindings And Resolve Effective Terminal Styles

**Files:**
- Regenerate: `frontend/bindings/github.com/xuthus5/mssh/internal/model/models.ts`
- Regenerate: `frontend/bindings/github.com/xuthus5/mssh/internal/service/themeservice.ts`
- Modify: `frontend/src/lib/terminalThemeCatalog.ts`
- Modify: `frontend/src/lib/terminalThemeCatalog.test.ts`
- Modify: `frontend/src/hooks/useThemeCatalog.ts`
- Modify: `frontend/src/hooks/useThemeCatalog.test.tsx`
- Modify: `frontend/src/store/appStore.ts`

**Interfaces:**
- Consumes generated `TerminalGlobalStyle`, `ThemeProfile.follow_global_style`, and `ThemeConfigurationInput.global_style`
- Produces: `profileToTerminalTheme(profile, globalStyle): TerminalTheme`
- Produces: `ThemeCatalogState.globalStyle`

- [ ] **Step 1: Generate bindings**

Run:

```bash
PATH="$HOME/.govm/go/bin:$PATH" wails3 generate bindings -ts -names -d frontend/bindings/ .
```

Verify generated bindings contain:

```text
TerminalGlobalStyle
TerminalGlobalStyleInput
follow_global_style
global_style
ThemeService.GetGlobalStyle
```

- [ ] **Step 2: Write failing effective-style tests**

Extend `terminalThemeCatalog.test.ts`:

```ts
it('uses global typography when the Profile follows global style', () => {
  const result = profileToTerminalTheme(
    { ...profile, follow_global_style: true, font_family: 'Profile Font', font_size: 20, cursor_style: 'block' },
    { font_family: 'Global Font', font_size: 16, cursor_style: 'underline' },
  )
  expect(result).toMatchObject({ fontFamily: 'Global Font', fontSize: 16, cursorStyle: 'underline' })
})

it('retains Profile typography while keeping Profile cursor color', () => {
  const result = profileToTerminalTheme(
    { ...profile, follow_global_style: false, font_family: 'Profile Font', font_size: 20, cursor_style: 'block' },
    globalStyle,
  )
  expect(result).toMatchObject({ fontFamily: 'Profile Font', fontSize: 20, cursorStyle: 'block', cursor: '#abcdef' })
})
```

Add hook tests proving startup, color-mode changes, configuration saves, and reset all resolve with the loaded global style.

- [ ] **Step 3: Run frontend resolver tests to verify RED**

Run:

```bash
npm --prefix frontend test -- --run src/lib/terminalThemeCatalog.test.ts src/hooks/useThemeCatalog.test.tsx
```

Expected: FAIL because the resolver and store do not accept global style.

- [ ] **Step 4: Implement effective style merging**

Update the mapper signature:

```ts
export function profileToTerminalTheme(
  profile: ThemeProfile,
  globalStyle: TerminalGlobalStyle,
): TerminalTheme {
  const style = profile.follow_global_style
    ? {
        fontFamily: globalStyle.font_family,
        fontSize: globalStyle.font_size,
        cursorStyle: globalStyle.cursor_style,
      }
    : {
        fontFamily: profile.font_family,
        fontSize: profile.font_size,
        cursorStyle: profile.cursor_style,
      }
  return { ...resolvedColors, ...style }
}
```

Color resolution, including cursor color, remains unchanged.

- [ ] **Step 5: Add global style to the catalog state**

Extend `ThemeCatalogState` and `initialState` with default global style. `loadThemeCatalog` must fetch `ThemeService.GetGlobalStyle()` in the same `Promise.all` as definitions, Profiles, Assignments, and interface color mode.

`applyEffectiveTerminalTheme` passes `state.globalStyle` to the mapper. No component or terminal hook may merge the style independently.

- [ ] **Step 6: Verify hot application tests**

Run:

```bash
npm --prefix frontend test -- --run src/lib/terminalThemeCatalog.test.ts src/hooks/useThemeCatalog.test.tsx src/hooks/useTerminal.test.tsx src/components/terminal/PlaybackTab.test.tsx
```

Expected: PASS, including already-open terminal option updates through the existing `terminalTheme` subscription.

- [ ] **Step 7: Commit bindings and resolver**

```bash
git add frontend/bindings frontend/src/lib/terminalThemeCatalog.ts frontend/src/lib/terminalThemeCatalog.test.ts frontend/src/hooks/useThemeCatalog.ts frontend/src/hooks/useThemeCatalog.test.tsx frontend/src/store/appStore.ts
git commit -m "feat(theme): resolve global terminal style"
git push origin main
```

---

### Task 4: Build Global And Per-Profile Settings UI

**Files:**
- Create: `frontend/src/components/settings/TerminalGlobalStyleEditor.tsx`
- Create: `frontend/src/components/settings/TerminalGlobalStyleEditor.test.tsx`
- Create: `frontend/src/components/settings/TerminalProfileStyleEditor.tsx`
- Create: `frontend/src/components/settings/TerminalProfileStyleEditor.test.tsx`
- Modify: `frontend/src/components/settings/TerminalThemeInspector.tsx`
- Modify: `frontend/src/components/settings/ThemeEditor.tsx`
- Modify: `frontend/src/components/settings/ThemeEditor.test.tsx`
- Modify: `frontend/src/components/settings/themeEditorState.ts`
- Modify: `frontend/src/components/settings/themeEditorState.test.ts`
- Modify: `frontend/src/components/settings/SettingsDialog.tsx`
- Modify: `frontend/src/components/settings/SettingsDialog.test.tsx`

**Interfaces:**
- Consumes: `ThemeCatalogState.globalStyle`
- Produces: `ThemeDraft.followGlobalStyle`
- Produces: `buildThemeConfiguration(...).global_style`
- Produces: commercial shadcn global and Profile-level style controls

- [ ] **Step 1: Write failing draft-state tests**

Define the draft model in tests:

```ts
export type ThemeDraft = TerminalTheme & {
  followGlobalStyle: boolean
}
```

Profile draft font fields always store the Profile fallback values. Add pure helpers:

```ts
export function effectiveDraftTheme(draft: ThemeDraft, globalStyle: TerminalGlobalStyle): TerminalTheme
export function terminalGlobalStyleInput(style: TerminalGlobalStyle): TerminalGlobalStyleInput
```

Test that following uses global typography without mutating fallback values, toggling off restores fallback values, and `buildThemeConfiguration` emits both `global_style` and `follow_global_style`.

- [ ] **Step 2: Run draft-state tests to verify RED**

Run:

```bash
npm --prefix frontend test -- --run src/components/settings/themeEditorState.test.ts
```

Expected: FAIL because the new draft fields and configuration output do not exist.

- [ ] **Step 3: Implement pure editor state**

Update `createThemeDrafts` to copy `profile.follow_global_style`. `themeToProfileInput` must persist dormant Profile values regardless of current follow state:

```ts
return {
  id: profile.id,
  name: profile.name,
  theme_id: profile.theme_id,
  follow_global_style: draft.followGlobalStyle,
  font_family: normalized.fontFamily,
  font_size: normalized.fontSize,
  cursor_style: normalized.cursorStyle,
  color_overrides: JSON.stringify(colorOverrides),
}
```

`effectiveDraftTheme` replaces only `fontFamily`, `fontSize`, and `cursorStyle`; it never changes `cursorColor`.

- [ ] **Step 4: Write failing component tests**

`TerminalGlobalStyleEditor.test.tsx` covers:

- Labeled terminal font and size inputs.
- `LabeledSelect` cursor options with labels `块状`, `下划线`, `竖线`.
- Controlled change callbacks.
- Disabled state while saving.

`TerminalProfileStyleEditor.test.tsx` covers:

- Follow switch defaults on.
- Effective global values are displayed and fields are disabled while following.
- Turning follow off displays Profile fallback values and enables fields.
- Turning follow on and off again preserves edited Profile values.
- Cursor color is absent from this component because it remains in the color inspector.

- [ ] **Step 5: Run component tests to verify RED**

Run:

```bash
npm --prefix frontend test -- --run src/components/settings/TerminalGlobalStyleEditor.test.tsx src/components/settings/TerminalProfileStyleEditor.test.tsx
```

Expected: FAIL because both components are new.

- [ ] **Step 6: Implement shadcn editor components**

`TerminalGlobalStyleEditor` uses a full `Card` composition with `Field`, `Input`, and `LabeledSelect`. It receives a controlled `TerminalGlobalStyle` draft and emits field-level changes.

`TerminalProfileStyleEditor` uses a `Card`, horizontal `Field`, `Switch`, and disabled inputs. The description explicitly states that cursor color remains part of the theme colors.

Use semantic tokens only, `rounded-xl`, `border-border`, and no raw dark-mode color classes.

- [ ] **Step 7: Integrate ThemeEditor**

Add `globalStyle` to `ThemeEditor` props and local draft state. Render the global card after the application-strategy card. Compute:

```ts
const effectiveTheme = effectiveDraftTheme(activeTheme, draftGlobalStyle)
```

Use `effectiveTheme` for `TerminalThemePreview`. Keep color controls bound to the Profile draft. Move font, size, and cursor-style controls from `TerminalThemeInspector` into `TerminalProfileStyleEditor`; cursor color stays in `TerminalThemeInspector`.

The existing save button submits one `ThemeConfigurationInput`. Dirty, validity, reset-disable, and pending states include global and follow changes.

- [ ] **Step 8: Update reset copy and SettingsDialog wiring**

Pass `globalStyle` from the catalog through `SettingsDialog` into `ThemeEditor`. Change the built-in reset confirmation to:

```text
恢复当前绑定内置主题的颜色和备用样式，并重新跟随全局字体与光标。全局字体与光标配置不会被修改。
```

Update the General Settings interface-font description so it no longer says terminal fonts are configured only by individual themes; it should say terminal typography is configured in the Terminal category.

- [ ] **Step 9: Run UI tests to verify GREEN**

Run:

```bash
npm --prefix frontend test -- --run \
  src/components/settings/themeEditorState.test.ts \
  src/components/settings/TerminalGlobalStyleEditor.test.tsx \
  src/components/settings/TerminalProfileStyleEditor.test.tsx \
  src/components/settings/ThemeEditor.test.tsx \
  src/components/settings/SettingsDialog.test.tsx
```

Expected: PASS with no React act warnings or accessibility errors.

- [ ] **Step 10: Commit settings UI**

```bash
git add frontend/src/components/settings
git commit -m "feat(settings): edit global terminal style"
git push origin main
```

---

### Task 5: Close Integration, Documentation, And Quality Gates

**Files:**
- Modify: `frontend/src/hooks/useThemeCatalog.test.tsx`
- Modify: `frontend/src/hooks/useTerminal.test.tsx`
- Modify: `frontend/src/components/terminal/PlaybackTab.test.tsx`
- Modify: `README.md` only if terminal settings documentation is currently inaccurate
- Update: `docs/superpowers/plans/2026-07-14-global-terminal-style.md`

**Interfaces:**
- Verifies the complete Go → Wails → Zustand → xterm path
- Produces no new public API beyond Tasks 1–4

- [ ] **Step 1: Add full-path regression tests**

Cover:

1. Startup with a following Dark Profile applies global font/style and Profile cursor color.
2. Saving a changed global style updates existing SSH terminal options.
3. Saving a changed global style updates existing playback terminal options.
4. Switching to a non-following Light or fixed Profile applies its fallback style.
5. Re-enabling follow hot-applies global style without deleting fallback values.
6. A failed SaveConfiguration leaves catalog state and open terminal options unchanged.

- [ ] **Step 2: Run focused integration tests**

Run:

```bash
npm --prefix frontend test -- --run \
  src/hooks/useThemeCatalog.test.tsx \
  src/hooks/useTerminal.test.tsx \
  src/components/terminal/PlaybackTab.test.tsx \
  src/components/settings/ThemeEditor.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run all Go tests and coverage**

Run:

```bash
PATH="$HOME/.govm/go/bin:$PATH" go test ./... -count=1
PATH="$HOME/.govm/go/bin:$PATH" go test -race ./... -count=1
PATH="$HOME/.govm/go/bin:$PATH" go test ./... -coverprofile=coverage.out -count=1
PATH="$HOME/.govm/go/bin:$PATH" go tool cover -func=coverage.out
```

Expected: PASS with project-required coverage. Remove `coverage.out` after recording the result.

- [ ] **Step 4: Run all frontend tests and coverage**

Run:

```bash
npm --prefix frontend test
npm --prefix frontend run test:coverage
```

Expected: PASS with Statements and Lines at or above `90%`.

- [ ] **Step 5: Format and lint**

Run:

```bash
PATH="$HOME/.govm/go/bin:$PATH" goimports-reviser -rm-unused -format ./...
PATH="$HOME/.govm/go/bin:$PATH" golangci-lint run --timeout 5m ./...
git diff --check
```

Expected: no issues.

- [ ] **Step 6: Build the desktop application**

Run:

```bash
PATH="$HOME/.govm/go/bin:$PATH" CGO_ENABLED=1 wails3 build
```

Expected: exit code `0`.

- [ ] **Step 7: Clean generated test and build artifacts**

```bash
rm -rf frontend/coverage frontend/dist
rm -f build/bin/mssh coverage.out
git status --short
```

Expected: only intended source, generated bindings, tests, and concise documentation changes remain.

- [ ] **Step 8: Request independent code review**

Review must specifically inspect:

- Final-schema replacement behavior with no legacy compatibility path.
- SaveConfiguration transaction rollback.
- Cursor color remaining Profile-owned.
- Global/fallback draft preservation across toggle cycles.
- Existing SSH and playback hot updates.
- Generated binding consistency.

Resolve all Critical and Important feedback before proceeding.

- [ ] **Step 9: Commit final integration fixes**

```bash
git add README.md docs frontend internal
git commit -m "test(theme): close global style integration"
git push origin main
```

- [ ] **Step 10: Verify remote state**

```bash
git status --short --branch
git log -1 --oneline --decorate
```

Expected: `main` matches `origin/main` with a clean working tree.
