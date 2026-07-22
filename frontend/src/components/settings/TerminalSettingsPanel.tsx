import { useCallback, useEffect, useState } from 'react'
import { AutoSaveStatusIndicator } from '@/components/settings/AutoSaveStatus'
import { TerminalBehaviorSettingsSection } from '@/components/settings/TerminalBehaviorSettings'
import { TerminalRendererSettingsSection } from '@/components/settings/TerminalRendererSettings'
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
  renderer: GeneralSettings['renderer']
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
    renderer: general.renderer,
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
    renderer: draft.renderer,
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
  const autoSave = useAutoSave({ value: draft, onSave: persist, delayMs: 450 })

  return (
    <div className="flex flex-col gap-5 pt-2">
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
          onRightClickActionChange={(value) => setDraft({ ...draft, rightClickAction: value })}
          onCopyOnSelectChange={(value) => setDraft({ ...draft, copyOnSelect: value })}
          onScrollbackLinesChange={(value) =>
            setDraft({ ...draft, scrollbackLines: value > 0 ? String(value) : '' })
          }
          onAutoReconnectChange={(value) => setDraft({ ...draft, autoReconnect: value })}
          onRestoreTabsOnStartupChange={(value) => setDraft({ ...draft, restoreTabsOnStartup: value })}
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
