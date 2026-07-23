import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { AutoSaveStatusIndicator } from '@/components/settings/AutoSaveStatus'
import { TerminalBehaviorSettingsSection } from '@/components/settings/TerminalBehaviorSettings'
import { TerminalRendererSettingsSection } from '@/components/settings/TerminalRendererSettings'
import { TerminalLocalShellSettingsSection } from '@/components/settings/TerminalLocalShellSettings'
import { TerminalConnectionDefaultsSettingsSection } from '@/components/settings/TerminalConnectionDefaultsSettings'
import { ThemeEditor } from '@/components/settings/ThemeEditor'
import { ThemeManager } from '@/components/settings/ThemeManager'
import { useAutoSave } from '@/hooks/useAutoSave'
import type { GeneralSettings } from '@/hooks/useSettings'
import type { ColorMode } from '@/lib/effectiveTerminalTheme'
import type {
  BuiltinThemeResetResult,
  TerminalGlobalStyle,
  ThemeAssignments,
  ThemeConfigurationInput,
  ThemeImportSummary,
  ThemeProfile,
  ThemeProfileInput,
} from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { t } from '@/i18n'

interface TerminalDraft {
  maxPoolSize: string
  defaultKeepAlive: string
  defaultTermType: string
  rightClickAction: GeneralSettings['rightClickAction']
  copyOnSelect: boolean
  scrollbackLines: string
  autoReconnect: boolean
  restoreTabsOnStartup: boolean
  historyPredict: boolean
  renderer: GeneralSettings['renderer']
  localShell: string
  localShellArgs: string
  localShellCwd: string
  localShellLogin: boolean
}

interface Props {
  general: GeneralSettings
  themeProfiles: ThemeProfile[]
  themeAssignments: ThemeAssignments
  terminalGlobalStyle: TerminalGlobalStyle
  colorMode: ColorMode
  onSaveGeneral: (settings: GeneralSettings) => Promise<void>
  onSaveThemeConfiguration: (configuration: ThemeConfigurationInput) => Promise<void>
  onImportThemes: (paths: string[]) => Promise<ThemeImportSummary>
  onCreateThemeProfile: (profile: ThemeProfileInput) => Promise<ThemeProfile | null>
  onUpdateThemeProfile: (profile: ThemeProfileInput) => Promise<void>
  onDeleteThemeProfile: (id: number) => Promise<void>
  onDeleteThemeDefinition: (id: number) => Promise<void>
  onResetBuiltinThemes: () => Promise<BuiltinThemeResetResult>
  settingsReady?: boolean
  loadError?: string
  onReloadSettings?: () => void
  themeLoadError?: string
  onReloadThemes?: () => void
}

function createDraft(general: GeneralSettings): TerminalDraft {
  return {
    maxPoolSize: String(general.maxPoolSize),
    defaultKeepAlive: String(general.defaultKeepAlive),
    defaultTermType: general.defaultTermType,
    rightClickAction: general.rightClickAction,
    copyOnSelect: general.copyOnSelect,
    scrollbackLines: String(general.scrollbackLines),
    autoReconnect: general.autoReconnect,
    restoreTabsOnStartup: general.restoreTabsOnStartup,
    historyPredict: general.historyPredict,
    renderer: general.renderer,
    localShell: general.localShell,
    localShellArgs: general.localShellArgs,
    localShellCwd: general.localShellCwd,
    localShellLogin: general.localShellLogin,
  }
}

function buildSavePayload(general: GeneralSettings, draft: TerminalDraft): GeneralSettings {
  return {
    ...general,
    maxPoolSize: parseInt(draft.maxPoolSize, 10) || 10,
    defaultKeepAlive: parseInt(draft.defaultKeepAlive, 10) || 60,
    defaultTermType: draft.defaultTermType,
    rightClickAction: draft.rightClickAction,
    copyOnSelect: draft.copyOnSelect,
    scrollbackLines: parseInt(draft.scrollbackLines, 10) || 10000,
    autoReconnect: draft.autoReconnect,
    restoreTabsOnStartup: draft.restoreTabsOnStartup,
    historyPredict: draft.historyPredict,
    renderer: draft.renderer,
    localShell: draft.localShell,
    localShellArgs: draft.localShellArgs,
    localShellCwd: draft.localShellCwd,
    localShellLogin: draft.localShellLogin,
  }
}

export function TerminalSettingsPanel({
  general,
  themeProfiles,
  themeAssignments,
  terminalGlobalStyle,
  colorMode,
  onSaveGeneral,
  onSaveThemeConfiguration,
  onImportThemes,
  onCreateThemeProfile,
  onUpdateThemeProfile,
  onDeleteThemeProfile,
  onDeleteThemeDefinition,
  onResetBuiltinThemes,
  settingsReady = true,
  loadError = '',
  onReloadSettings,
  themeLoadError = '',
  onReloadThemes,
}: Props) {
  const [draft, setDraft] = useState(() => createDraft(general))
  useEffect(() => {
    setDraft(createDraft(general))
  }, [general])

  const persist = useCallback(
    async (next: TerminalDraft) => {
      await onSaveGeneral(buildSavePayload(general, next))
    },
    [general, onSaveGeneral],
  )
  const autoSave = useAutoSave({ value: draft, onSave: persist, isReady: settingsReady, delayMs: 450 })

  return (
    <div className="flex flex-col gap-5 pt-2">
      {loadError ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {t('加载设置失败: ${}', loadError)}
          {onReloadSettings ? (
            <Button type="button" size="xs" variant="outline" className="ml-2" onClick={() => { onReloadSettings() }}>{t('重试')}</Button>
          ) : null}
        </div>
      ) : null}
      {themeLoadError ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {t('加载主题失败: ${}', themeLoadError)}
          {onReloadThemes ? (
            <Button type="button" size="xs" variant="outline" className="ml-2" onClick={() => { void onReloadThemes() }}>{t('重试')}</Button>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{t('终端连接与交互偏好会自动保存。')}</p>
          <AutoSaveStatusIndicator status={autoSave.status} error={autoSave.error} />
        </div>
        <TerminalConnectionDefaultsSettingsSection
          maxPoolSize={draft.maxPoolSize}
          defaultKeepAlive={draft.defaultKeepAlive}
          defaultTermType={draft.defaultTermType}
          onMaxPoolSizeChange={(value) => setDraft({ ...draft, maxPoolSize: value })}
          onDefaultKeepAliveChange={(value) => setDraft({ ...draft, defaultKeepAlive: value })}
          onDefaultTermTypeChange={(value) => setDraft({ ...draft, defaultTermType: value })}
        />
        <TerminalBehaviorSettingsSection
          rightClickAction={draft.rightClickAction}
          copyOnSelect={draft.copyOnSelect}
          scrollbackLines={draft.scrollbackLines}
          autoReconnect={draft.autoReconnect}
          restoreTabsOnStartup={draft.restoreTabsOnStartup}
          historyPredict={draft.historyPredict}
          onRightClickActionChange={(value) => setDraft({ ...draft, rightClickAction: value })}
          onCopyOnSelectChange={(value) => setDraft({ ...draft, copyOnSelect: value })}
          onScrollbackLinesChange={(value) =>
            setDraft({ ...draft, scrollbackLines: value > 0 ? String(value) : '' })
          }
          onAutoReconnectChange={(value) => setDraft({ ...draft, autoReconnect: value })}
          onRestoreTabsOnStartupChange={(value) => setDraft({ ...draft, restoreTabsOnStartup: value })}
          onHistoryPredictChange={(value) => setDraft({ ...draft, historyPredict: value })}
        />
        <TerminalLocalShellSettingsSection
          shell={draft.localShell}
          args={draft.localShellArgs}
          cwd={draft.localShellCwd}
          login={draft.localShellLogin}
          onShellChange={(value) => setDraft({ ...draft, localShell: value })}
          onArgsChange={(value) => setDraft({ ...draft, localShellArgs: value })}
          onCwdChange={(value) => setDraft({ ...draft, localShellCwd: value })}
          onLoginChange={(value) => setDraft({ ...draft, localShellLogin: value })}
        />
        <TerminalRendererSettingsSection
          renderer={draft.renderer}
          onRendererChange={(value) => setDraft({ ...draft, renderer: value })}
        />
      </div>
      <ThemeEditor
        profiles={themeProfiles}
        assignments={themeAssignments}
        globalStyle={terminalGlobalStyle}
        colorMode={colorMode}
        onSave={onSaveThemeConfiguration}
        onResetBuiltins={onResetBuiltinThemes}
      />
      <ThemeManager
        profiles={themeProfiles}
        onImport={onImportThemes}
        onCreateProfile={onCreateThemeProfile}
        onUpdateProfile={onUpdateThemeProfile}
        onDeleteProfile={onDeleteThemeProfile}
        onDeleteDefinition={onDeleteThemeDefinition}
      />
    </div>
  )
}
