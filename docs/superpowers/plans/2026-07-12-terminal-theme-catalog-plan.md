# Terminal Theme Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a database-backed terminal theme catalog with Dark/Light profile assignments, `.itermcolors` import, automatic application-mode switching, and a commercial theme-management UI.

**Architecture:** Rebuild the existing unused `themes` persistence layer as immutable theme definitions plus editable profiles. `ThemeService` owns defaults, assignments, import transactions, and deletion rules; the frontend loads a single catalog state and derives the active xterm theme from the shared application color mode.

**Tech Stack:** Go 1.26, SQLite, Wails v3 bindings, React 19, TypeScript, Zustand, Vitest, shadcn/ui, Tailwind CSS v4.

## Global Constraints

- No legacy data migration is required; the schema may be replaced directly.
- Built-in definitions cannot be deleted, and referenced definitions cannot be deleted.
- File and directory permissions remain `0600` and `0700` where files are created.
- New Go and frontend behavior must use TDD and achieve at least 90% line coverage for the added logic.
- Run `goimports-reviser`, `golangci-lint`, Go race tests, frontend tests, and `wails3 build` before the final push.

---

### Task 1: Theme Domain and Schema

**Files:**
- Modify: `internal/model/theme.go`
- Modify: `internal/model/input.go`
- Modify: `internal/store/db.go`
- Modify: `internal/store/db_test.go`
- Create: `internal/model/theme_test.go`

**Interfaces:**
- Produces: `ThemeMode`, `ThemeSourceType`, `TerminalColorPayload`, `ThemeDefinition`, `ThemeProfile`, `ThemeAssignments`, and their input DTOs.
- Produces tables: `themes` and `terminal_theme_profiles` exactly as defined by the approved spec.

- [ ] Write failing model tests for JSON round-trip, valid enums, and zero-value-safe DTO conversion.
- [ ] Write a failing DB migration test asserting all new columns, the profile table, foreign keys, and unique fingerprint index.
- [ ] Replace the legacy `Theme` model with focused definition/profile/assignment models and input converters.
- [ ] Replace the legacy themes migration with the new schema and enable SQLite foreign keys on every opened connection.
- [ ] Run `go test ./internal/model ./internal/store -run 'Theme|Migration'` and confirm PASS.
- [ ] Commit with `feat(theme): add catalog domain schema`.

### Task 2: Catalog Store, Defaults, and Assignments

**Files:**
- Replace: `internal/store/theme.go`
- Replace: `internal/store/theme_test.go`
- Replace: `internal/service/theme.go`
- Replace: `internal/service/theme_test.go`
- Modify: `internal/app/app.go`

**Interfaces:**
- Consumes: Task 1 domain models.
- Produces store functions `ListThemeDefinitions`, `GetThemeDefinition`, `CreateThemeDefinition`, `DeleteThemeDefinition`, `ListThemeProfiles`, `GetThemeProfile`, `CreateThemeProfile`, `UpdateThemeProfile`, `DeleteThemeProfile`, and assignment helpers.
- Produces service methods `ListDefinitions`, `ListProfiles`, `GetProfile`, `CreateCustomProfile`, `UpdateProfile`, `DeleteProfile`, `DeleteDefinition`, `GetAssignments`, and `SaveAssignments`.

- [ ] Write failing store tests for CRUD, filtering by mode, duplicate fingerprints, built-in deletion, referenced-definition deletion, and assignment persistence.
- [ ] Write failing service tests for default GitHub Dark/Light initialization and fallback recovery when an assignment references a missing profile.
- [ ] Implement parameterized store queries and transaction helpers without `defer` inside loops.
- [ ] Implement deterministic built-in definitions/profiles and initialize them in `app.New` before bindings become available.
- [ ] Implement service validation for font size, cursor style, mode compatibility, immutable definitions, and user-facing wrapped errors.
- [ ] Run `go test -race ./internal/store ./internal/service ./internal/app` and confirm PASS.
- [ ] Commit with `feat(theme): add catalog service`.

### Task 3: iTerm2 Color Scheme Importer

**Files:**
- Create: `internal/themeimport/importer.go`
- Create: `internal/themeimport/itermcolors.go`
- Create: `internal/themeimport/itermcolors_test.go`
- Create: `internal/themeimport/testdata/valid.itermcolors`
- Create: `internal/themeimport/testdata/light.itermcolors`
- Create: `internal/themeimport/testdata/invalid.itermcolors`
- Modify: `internal/service/theme.go`
- Modify: `internal/service/theme_test.go`

**Interfaces:**
- Produces `ThemeImporter` with `Supports(filename string, content []byte) bool` and `Import(filename string, content []byte) ([]model.ThemeDefinition, error)`.
- Produces `ThemeService.ImportFiles(paths []string) (model.ThemeImportSummary, error)`.

- [ ] Write failing parser tests for all required iTerm2 keys, color-space conversion, clamping, light/dark classification, malformed plist, missing colors, external entity rejection, and deterministic SHA-256 fingerprints.
- [ ] Implement a bounded XML plist parser using the Go standard library only; reject files larger than 2 MiB and never resolve external resources.
- [ ] Write failing service tests for multiple files, partial success, unsupported extensions, duplicate fingerprints, and transactional definition/profile creation per file.
- [ ] Implement importer dispatch and structured result entries with `imported`, `duplicate`, and `failed` statuses.
- [ ] Run `go test -race ./internal/themeimport ./internal/service -run 'Import|ITerm'` and confirm PASS.
- [ ] Commit with `feat(theme): import iterm color schemes`.

### Task 4: Frontend Catalog State and Shared Color Mode

**Files:**
- Create: `frontend/src/lib/terminalThemeCatalog.ts`
- Create: `frontend/src/lib/terminalThemeCatalog.test.ts`
- Create: `frontend/src/hooks/useThemeCatalog.ts`
- Create: `frontend/src/hooks/useThemeCatalog.test.tsx`
- Modify: `frontend/src/store/appStore.ts`
- Modify: `frontend/src/components/layout/WindowTitleBar.tsx`
- Modify: `frontend/src/components/layout/WindowTitleBar.test.tsx`
- Modify: `frontend/src/components/layout/Sidebar.tsx`
- Modify: `frontend/src/hooks/useSettings.ts`

**Interfaces:**
- Consumes generated ThemeService bindings from Tasks 1–3.
- Produces `ColorMode = 'dark' | 'light'`, catalog state, `loadCatalog`, `saveAssignments`, `saveProfile`, `importThemes`, and `setColorMode`.
- Produces a pure `profileToTerminalTheme(profile)` adapter for `appStore.setTerminalTheme`.

- [ ] Write failing pure adapter tests covering definition colors, overrides, cursor style, font fields, and ANSI fallback.
- [ ] Write failing hook tests for startup loading, Dark/Light assignment selection, current-terminal hot update, save failure rollback, and missing-profile fallback.
- [ ] Add `colorMode` and catalog actions to Zustand; remove `WindowTitleBar` local mode ownership.
- [ ] Refactor `WindowTitleBar` to call the shared async mode action while preserving localStorage startup acceleration and database persistence.
- [ ] Remove legacy `terminal.theme` loading/saving from `useSettings` and wire Sidebar/SettingsDialog to the catalog hook.
- [ ] Run `npm test --prefix frontend -- src/lib/terminalThemeCatalog.test.ts src/hooks/useThemeCatalog.test.tsx src/components/layout/WindowTitleBar.test.tsx` and confirm PASS.
- [ ] Commit with `refactor(theme): centralize color mode state`.

### Task 5: Dual-Mode Terminal Theme Editor

**Files:**
- Modify: `frontend/src/components/settings/ThemeEditor.tsx`
- Modify: `frontend/src/components/settings/ThemeEditor.test.tsx`
- Modify: `frontend/src/components/settings/ThemePresetCombobox.tsx`
- Modify: `frontend/src/components/settings/TerminalThemeInspector.tsx`
- Modify: `frontend/src/components/settings/TerminalThemePreview.tsx`
- Create: `frontend/src/components/settings/ThemeModeSelector.tsx`
- Create: `frontend/src/components/settings/ThemeModeSelector.test.tsx`

**Interfaces:**
- Consumes catalog definitions, profiles, assignments, and save callbacks from Task 4.
- Produces independent Dark and Light profile drafts and one atomic save action.

- [ ] Write failing tests for two named dropdowns, compatible filtering, `universal` inclusion, incompatible-theme warning, independent drafts, active-mode preview, and atomic saving.
- [ ] Replace the single preset selector with Dark Mode and Light Mode selectors showing source, mode badge, and palette summary.
- [ ] Add an editor mode switch that changes only the preview/inspector target and never discards the other draft.
- [ ] Keep HEX validation, ANSI keyboard navigation, missing-color recovery, and prop synchronization from the current editor.
- [ ] Run `npm test --prefix frontend -- src/components/settings/ThemeEditor.test.tsx src/components/settings/ThemeModeSelector.test.tsx` and confirm PASS.
- [ ] Commit with `feat(settings): add dual mode terminal themes`.

### Task 6: Theme Management and Import UI

**Files:**
- Create: `frontend/src/components/settings/ThemeManager.tsx`
- Create: `frontend/src/components/settings/ThemeManager.test.tsx`
- Create: `frontend/src/components/settings/ThemeImportResults.tsx`
- Modify: `frontend/src/components/settings/SettingsDialog.tsx`
- Modify: `frontend/src/components/settings/SettingsDialog.test.tsx`

**Interfaces:**
- Consumes catalog actions from Task 4.
- Produces import, search, preview, duplicate, rename, and deletion interactions.

- [ ] Write failing tests for multi-file picker arguments, import success/duplicate/failure summaries, search, source/license display, built-in delete protection, referenced delete errors, profile rename, and duplicate-to-custom flow.
- [ ] Implement a shadcn Card/Table management surface reachable from the terminal settings page without adding a new top-level settings category.
- [ ] Use Wails `Dialogs.OpenFile` with `*.itermcolors`, multiple selection, and files-only semantics.
- [ ] Show structured import results with accessible status badges and actionable error text.
- [ ] Implement confirmation dialogs for destructive actions and keep built-in actions visibly disabled.
- [ ] Run `npm test --prefix frontend -- src/components/settings/ThemeManager.test.tsx src/components/settings/SettingsDialog.test.tsx` and confirm PASS.
- [ ] Commit with `feat(settings): manage terminal themes`.

### Task 7: Bindings, Integration, Documentation, and Delivery

**Files:**
- Regenerate: `frontend/bindings/github.com/xuthus5/mssh/internal/model/models.ts`
- Regenerate: `frontend/bindings/github.com/xuthus5/mssh/internal/service/themeservice.ts`
- Modify: `frontend/src/lib/wails/index.ts` only if generated exports require adjustment.
- Modify: `README.md` only when user-facing import instructions need documentation.
- Modify: `docs/superpowers/plans/2026-07-12-terminal-theme-catalog-plan.md`

**Interfaces:**
- Validates all previous tasks as one application flow.

- [ ] Run `wails3 generate bindings -ts -names -d frontend/bindings .` and verify generated argument and return types contain no time parsing regressions.
- [ ] Add or update integration tests proving existing xterm instances, new sessions, and playback terminals all consume the active assigned profile.
- [ ] Run targeted frontend coverage for all new catalog/editor/manager files with line and function thresholds of 90%.
- [ ] Run `goimports-reviser -project-name github.com/xuthus5/mssh -rm-unused -set-alias -format ./...`.
- [ ] Run `golangci-lint run`, `go test -race ./...`, and the repository Go coverage command; require total coverage at least 90%.
- [ ] Run `npm test --prefix frontend`, `npm run build --prefix frontend`, and `wails3 build`; fix every error before delivery.
- [ ] Clean generated coverage files, temporary importer fixtures outside testdata, and build binaries.
- [ ] Mark this plan complete, commit final integration changes, push `main`, and verify `HEAD == origin/main` with no task-related untracked files.
