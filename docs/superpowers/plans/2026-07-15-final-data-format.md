# Final Data Format Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all application-owned historical data/API compatibility and enforce one destructive, versioned final format.

**Architecture:** Replace incremental SQLite migrations with a single `PRAGMA user_version` gate that recreates all application tables when the format changes. Remove obsolete RPC adapters, make sync documents and frontend Tabs strict, and rely on version bumps rather than conversion branches for future incompatible changes.

**Tech Stack:** Go 1.26, SQLite, Wails v3, React 19, TypeScript, Zustand, Vitest, testify.

## Global Constraints

- No historical database, settings, RPC, Tab, or sync document compatibility is retained.
- Database format mismatches delete all application tables and data.
- External formats, platform compatibility, font fallback, and runtime error recovery remain supported.
- New files use `0600`; generated artifacts are removed before commit.
- Every incompatible future format change increments `databaseFormatVersion` instead of adding migration code.

---

### Task 1: Replace Incremental Migrations With Final Schema Gate

**Files:**
- Modify: `internal/store/db.go`
- Modify: `internal/store/db_test.go`
- Modify: `internal/store/setting.go`
- Modify: `internal/store/setting_test.go`
- Modify: `internal/store/theme_schema.go`
- Modify: `internal/store/theme_schema_test.go`
- Modify: `internal/app/app.go`
- Modify: `internal/app/app_test.go`
- Modify: `internal/service/testutil/db.go`
- Modify: store test helpers calling `Migrate`

**Interfaces:**
- Produces: `store.InitializeSchema(db *sql.DB) error`
- Produces: `const databaseFormatVersion = 1`
- Removes: `store.Migrate`, `ensureSessionRecencySchema`, `tableColumns`, `ensureDefaultFolderSchema`, `folderDefaultColumnExists`, `ensureSettingsSchema`, `ensureThemeCatalogSchema`, and theme schema replacement helpers.

- [x] **Step 1: Write destructive format-gate tests**

Add tests that create a version-0 database containing sentinel legacy rows, call `InitializeSchema`, and assert all sentinels are gone, all final columns exist, one default folder exists, and `PRAGMA user_version = 1`.

- [x] **Step 2: Verify database tests fail**

Run:

```bash
PATH="$HOME/.govm/go/bin:$PATH" go test ./internal/store -run 'TestInitializeSchema|TestDatabaseFormat' -count=1
```

Expected: FAIL because `InitializeSchema` and the version gate do not exist.

- [x] **Step 3: Implement final DDL and destructive reset**

Create all current tables directly with final columns. On a version mismatch, drop tables in reverse dependency order inside a transaction, create all tables, initialize the default folder, and set `PRAGMA user_version`.

- [x] **Step 4: Replace all `Migrate` callers**

Update application startup and test database helpers to call `InitializeSchema`. Change startup logging from migration terminology to schema initialization.

- [x] **Step 5: Remove migration-specific tests and helpers**

Delete tests that assert `ALTER TABLE`, old table detection, data preservation, or per-theme replacement. Keep final-schema, idempotency, error, and transaction rollback tests.

- [x] **Step 6: Verify store and app tests**

Run:

```bash
PATH="$HOME/.govm/go/bin:$PATH" go test ./internal/store ./internal/app ./internal/service/testutil -count=1
```

Expected: PASS.

---

### Task 2: Remove Legacy Settings And Obsolete RPCs

**Files:**
- Modify: `internal/store/setting.go`
- Modify: `internal/store/setting_test.go`
- Modify: `internal/service/setting.go`
- Modify: `internal/service/setting_test.go`
- Modify: `internal/service/session.go`
- Modify: `internal/service/session_connect.go`
- Modify: `internal/service/session_test.go`
- Modify: `internal/service/log.go`
- Modify: `internal/service/log_test.go`
- Modify: `e2e/services_test.go`
- Modify: `e2e/bindings_test.go`
- Regenerate: `frontend/bindings/github.com/xuthus5/mssh/internal/service/*.ts`
- Modify: `frontend/src/lib/__tests__/bindings.test.ts`
- Modify: `frontend/src/hooks/useSettings.test.ts`
- Modify: `frontend/src/hooks/useSession.test.ts`

**Interfaces:**
- Removes: `SettingService.GetSetting/SetSetting`
- Removes: `SessionService.Connect/Disconnect`
- Removes: `LogService.StartRecording/StopRecording`
- Retains: typed settings APIs, internal `SessionService.connect/disconnect`, and terminal-bound recording APIs.

- [x] **Step 1: Write strict settings and binding tests**

Assert `legacy` namespace, non-prefixed keys, and versions other than `1` are rejected. Update binding contract tests so obsolete methods are absent.

- [x] **Step 2: Verify tests fail against legacy methods**

Run:

```bash
PATH="$HOME/.govm/go/bin:$PATH" go test ./internal/store ./internal/service ./e2e -run 'Setting|Binding|Recording|Session' -count=1
npm --prefix frontend test -- --run src/lib/__tests__/bindings.test.ts src/hooks/useSettings.test.ts src/hooks/useSession.test.ts
```

Expected: FAIL until old methods and mocks are removed.

- [x] **Step 3: Delete legacy adapters and public methods**

Remove raw string settings conversion, public session connect/disconnect wrappers, and path/log-ID recording lifecycle. Keep only final typed and terminal-bound APIs.

- [x] **Step 4: Regenerate Wails bindings**

Run:

```bash
PATH="$HOME/.govm/go/bin:$PATH" wails3 generate bindings -ts -names -d frontend/bindings/ .
```

Verify generated services do not contain the removed methods.

- [x] **Step 5: Verify service and binding tests**

Run the commands from Step 2 and expect PASS.

---

### Task 3: Enforce One Sync Document Version

**Files:**
- Modify: `internal/service/sync.go`
- Modify: `internal/service/sync_test.go`

**Interfaces:**
- Produces: `const syncFormatVersion = 1`
- Produces: JSON field `format_version`

- [x] **Step 1: Write strict import tests**

Cover valid version-1 round trips and rejection of missing version, wrong version, unknown fields, missing arrays, and trailing JSON values.

- [x] **Step 2: Verify strict import tests fail**

Run:

```bash
PATH="$HOME/.govm/go/bin:$PATH" go test ./internal/service -run 'TestSyncService' -count=1
```

Expected: FAIL because imports are currently unversioned and permissive.

- [x] **Step 3: Implement strict decoding before writes**

Add `format_version`, `DisallowUnknownFields`, required-array validation, exact version validation, and EOF validation before database insertion begins.

- [x] **Step 4: Verify sync tests pass**

Run the command from Step 2 and expect PASS.

---

### Task 4: Replace Frontend Tab Compatibility Shape

**Files:**
- Modify: `frontend/src/store/appStore.ts`
- Modify: `frontend/src/store/appStoreActions.ts`
- Modify: `frontend/src/lib/terminalTabs.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/hooks/useSidebarState.ts`
- Modify: `frontend/src/components/layout/StatusBar.tsx`
- Modify: `frontend/src/components/layout/DynamicTabStrip.tsx`
- Modify: `frontend/src/components/terminal/TerminalLayers.tsx`
- Modify: `frontend/src/components/terminal/TerminalSplit.tsx`
- Modify: `frontend/src/components/terminal/TerminalToolbar.tsx`
- Modify: `frontend/src/components/terminal/SessionLog.tsx`
- Modify: all affected frontend tests and fixtures

**Interfaces:**
- Produces: `type Tab = TerminalTab | PlaybackTab`
- Produces: required `TerminalTab.terminalId`, `TerminalTab.sessionId`, and `PlaybackTab.recordingPath`

- [x] **Step 1: Change tests to final Tab shapes**

Update fixtures and assertions so every terminal Tab has `terminalId/sessionId` and every playback Tab has `recordingPath`. Delete tests that intentionally omit final fields.

- [x] **Step 2: Verify TypeScript/tests expose compatibility reads**

Run:

```bash
npm --prefix frontend test -- --run src/store/appStore.test.ts src/components/terminal/TerminalLayers.test.tsx src/components/layout/DynamicTabStrip.test.tsx src/App.test.tsx
npm --prefix frontend run build
```

Expected: FAIL while code still uses the shared optional shape.

- [x] **Step 3: Implement discriminated Tab union**

Separate terminal IDs, session IDs, and recording paths. Remove all `terminalId ?? id`, `sessionId ?? 0`, and playback `terminalId` branches.

- [x] **Step 4: Remove legacy zero-time detection**

Delete the `0001-01-01` special case and its legacy test. Keep generic invalid-date error handling.

- [x] **Step 5: Verify frontend tests and build**

Run the commands from Step 2 and expect PASS.

---

### Task 5: Remove Stale Builtin Compatibility And Close Quality Gates

**Files:**
- Modify: `internal/service/theme_builtin.go`
- Modify: `internal/service/theme_builtin_test.go`
- Modify: `README.md`
- Update: `docs/superpowers/plans/2026-07-15-final-data-format.md`

**Interfaces:**
- Removes: stale builtin definition comparison/replacement and assignment remapping for historical catalogs.
- Retains: creation of the current builtin catalog, normal default assignment initialization, and user-triggered builtin reset.

- [x] **Step 1: Remove stale catalog reconciliation tests**

Delete tests that create historical builtin metadata and expect replacement/remapping. Keep current-catalog initialization and reset tests.

- [x] **Step 2: Remove stale catalog production branches**

Delete old builtin comparison and replacement functions. Document that builtin catalog changes require a database format version bump.

- [x] **Step 3: Update concise documentation**

Document destructive format resets and strict versioned exports. Replace “safe migration” wording for folder deletion with “safe reassignment”.

- [x] **Step 4: Run complete verification**

```bash
PATH="$HOME/.govm/go/bin:$PATH" goimports-reviser -rm-unused -format ./...
PATH="$HOME/.govm/go/bin:$PATH" go test ./... -count=1
PATH="$HOME/.govm/go/bin:$PATH" go test -race ./... -count=1
PATH="$HOME/.govm/go/bin:$PATH" go test ./... -coverprofile=coverage.out -count=1
PATH="$HOME/.govm/go/bin:$PATH" go tool cover -func=coverage.out
PATH="$HOME/.govm/go/bin:$PATH" golangci-lint run --timeout 5m ./...
npm --prefix frontend test
npm --prefix frontend run test:coverage
npm --prefix frontend run build
PATH="$HOME/.govm/go/bin:$PATH" CGO_ENABLED=1 wails3 build
git diff --check
```

Expected: all tests/builds pass, Go and frontend project coverage remain at least `90%`, and lint reports zero issues.

- [x] **Step 5: Request independent review**

Review the destructive reset boundary, absence of old adapters, strict sync decoding, frontend Tab exhaustiveness, generated binding consistency, and absence of compatibility branches.

- [x] **Step 6: Clean artifacts, commit, and push**

```bash
rm -rf frontend/coverage frontend/dist
rm -f build/bin/mssh coverage.out
git add -A
git commit -m "refactor(data): enforce final formats"
git push origin main
git status --short --branch
```

Expected: local `main` equals `origin/main` and the working tree is clean.
