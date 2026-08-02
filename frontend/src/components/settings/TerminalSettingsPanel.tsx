import { useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { TerminalBehaviorSettingsSection } from '@/components/settings/TerminalBehaviorSettings'
import { TerminalRendererSettingsSection } from '@/components/settings/TerminalRendererSettings'
import { TerminalKeywordHighlightSettingsSection } from '@/components/settings/TerminalKeywordHighlightSettings'
import { TerminalLocalShellSettingsSection } from '@/components/settings/TerminalLocalShellSettings'
import { TerminalConnectionDefaultsSettingsSection } from '@/components/settings/TerminalConnectionDefaultsSettings'
import { ThemeEditor } from '@/components/settings/ThemeEditor'
import { ThemeManager } from '@/components/settings/ThemeManager'
import { useAutoSave } from '@/hooks/useAutoSave'
import { useDraftSync } from '@/hooks/useDraftSync'
import { useLocalShellCandidates } from '@/hooks/useLocalShellCandidates'
import { DEFAULT_KEYWORD_HIGHLIGHT_SETTINGS } from '@/store/terminalKeywordHighlightStore'
import { DEFAULT_TERMINAL_POOL_SIZE } from '@/hooks/generalSettingsModel'
import type { GeneralSettings, GeneralSettingsSaveOptions } from '@/hooks/useSettings'
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
  keywordHighlightEnabled: boolean
  keywordHighlightCaseInsensitive: boolean
  keywordHighlightRules: GeneralSettings['keywordHighlightRules']
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
  onSaveGeneral: (settings: GeneralSettings, options?: GeneralSettingsSaveOptions) => Promise<void>
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
    keywordHighlightEnabled: general.keywordHighlightEnabled,
    keywordHighlightCaseInsensitive: general.keywordHighlightCaseInsensitive,
    keywordHighlightRules: general.keywordHighlightRules,
    localShell: general.localShell,
    localShellArgs: general.localShellArgs,
    localShellCwd: general.localShellCwd,
    localShellLogin: general.localShellLogin,
  }
}

function buildSavePayload(general: GeneralSettings, draft: TerminalDraft): GeneralSettings {
  return {
    ...general,
    maxPoolSize: parseInt(draft.maxPoolSize, 10) || DEFAULT_TERMINAL_POOL_SIZE,
    defaultKeepAlive: parseInt(draft.defaultKeepAlive, 10) || 60,
    defaultTermType: draft.defaultTermType,
    rightClickAction: draft.rightClickAction,
    copyOnSelect: draft.copyOnSelect,
    scrollbackLines: parseInt(draft.scrollbackLines, 10) || 10000,
    autoReconnect: draft.autoReconnect,
    restoreTabsOnStartup: draft.restoreTabsOnStartup,
    historyPredict: draft.historyPredict,
    renderer: draft.renderer,
    keywordHighlightEnabled: draft.keywordHighlightEnabled,
    keywordHighlightCaseInsensitive: draft.keywordHighlightCaseInsensitive,
    keywordHighlightRules: draft.keywordHighlightRules,
    localShell: draft.localShell,
    localShellArgs: draft.localShellArgs,
    localShellCwd: draft.localShellCwd,
    localShellLogin: draft.localShellLogin,
  }
}

function useTerminalDraft({ general, onSaveGeneral, settingsReady = true }: Pick<Props, 'general' | 'onSaveGeneral' | 'settingsReady'>) {
  const { draft, setDraft, acknowledgeSaved, baselineRevision } = useDraftSync({ source: general, createDraft })
  const persist = useCallback(
    async (next: TerminalDraft) => {
      await onSaveGeneral(buildSavePayload(general, next), { scope: 'terminal' })
      acknowledgeSaved(next)
    },
    [acknowledgeSaved, general, onSaveGeneral],
  )
  useAutoSave({ value: draft, onSave: persist, isReady: settingsReady, delayMs: 450, baselineRevision, notify: true })
  const update = <Key extends keyof TerminalDraft>(key: Key, value: TerminalDraft[Key]) => setDraft({ ...draft, [key]: value })
  return { draft, update }
}

export function TerminalSettingsPanel(props: Props) {
  const model = useTerminalDraft(props)
  return (
    <div className="flex flex-col gap-5 pt-2">
      <SettingsErrors {...props} />
      <TerminalPreferenceSections model={model} />
      <ThemeSections {...props} />
    </div>
  )
}

type TerminalModel = ReturnType<typeof useTerminalDraft>

function SettingsErrors({ loadError = '', onReloadSettings, themeLoadError = '', onReloadThemes }: Pick<Props, 'loadError' | 'onReloadSettings' | 'themeLoadError' | 'onReloadThemes'>) {
  return <>{loadError ? <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{t('加载设置失败: ${}', loadError)}{onReloadSettings ? <Button type="button" size="xs" variant="outline" className="ml-2" onClick={onReloadSettings}>{t('重试')}</Button> : null}</div> : null}{themeLoadError ? <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{t('加载主题失败: ${}', themeLoadError)}{onReloadThemes ? <Button type="button" size="xs" variant="outline" className="ml-2" onClick={() => { void onReloadThemes() }}>{t('重试')}</Button> : null}</div> : null}</>
}

function TerminalPreferenceSections({ model }: { model: TerminalModel }) {
  const { draft, update } = model
  const shellCandidates = useLocalShellCandidates()
  return <div className="flex flex-col gap-3"><div className="flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{t('终端连接与交互偏好会自动保存。')}</p></div><TerminalConnectionDefaultsSettingsSection maxPoolSize={draft.maxPoolSize} defaultKeepAlive={draft.defaultKeepAlive} defaultTermType={draft.defaultTermType} onMaxPoolSizeChange={(value) => update('maxPoolSize', value)} onDefaultKeepAliveChange={(value) => update('defaultKeepAlive', value)} onDefaultTermTypeChange={(value) => update('defaultTermType', value)} /><TerminalBehaviorSettingsSection rightClickAction={draft.rightClickAction} copyOnSelect={draft.copyOnSelect} scrollbackLines={draft.scrollbackLines} autoReconnect={draft.autoReconnect} restoreTabsOnStartup={draft.restoreTabsOnStartup} historyPredict={draft.historyPredict} onRightClickActionChange={(value) => update('rightClickAction', value)} onCopyOnSelectChange={(value) => update('copyOnSelect', value)} onScrollbackLinesChange={(value) => update('scrollbackLines', value > 0 ? String(value) : '')} onAutoReconnectChange={(value) => update('autoReconnect', value)} onRestoreTabsOnStartupChange={(value) => update('restoreTabsOnStartup', value)} onHistoryPredictChange={(value) => update('historyPredict', value)} /><TerminalLocalShellSettingsSection shell={draft.localShell} args={draft.localShellArgs} cwd={draft.localShellCwd} login={draft.localShellLogin} candidates={shellCandidates} onShellChange={(value) => update('localShell', value)} onArgsChange={(value) => update('localShellArgs', value)} onCwdChange={(value) => update('localShellCwd', value)} onLoginChange={(value) => update('localShellLogin', value)} /><TerminalKeywordHighlightSettingsSection enabled={draft.keywordHighlightEnabled} caseInsensitive={draft.keywordHighlightCaseInsensitive} rules={draft.keywordHighlightRules} onEnabledChange={(value) => update('keywordHighlightEnabled', value)} onCaseInsensitiveChange={(value) => update('keywordHighlightCaseInsensitive', value)} onRulesChange={(value) => update('keywordHighlightRules', value)} onReset={() => update('keywordHighlightRules', DEFAULT_KEYWORD_HIGHLIGHT_SETTINGS.rules)} /><TerminalRendererSettingsSection renderer={draft.renderer} onRendererChange={(value) => update('renderer', value)} /></div>
}

function ThemeSections(props: Pick<Props, 'themeProfiles' | 'themeAssignments' | 'terminalGlobalStyle' | 'colorMode' | 'onSaveThemeConfiguration' | 'onResetBuiltinThemes' | 'onImportThemes' | 'onCreateThemeProfile' | 'onUpdateThemeProfile' | 'onDeleteThemeProfile' | 'onDeleteThemeDefinition'>) {
  return <><ThemeEditor profiles={props.themeProfiles} assignments={props.themeAssignments} globalStyle={props.terminalGlobalStyle} colorMode={props.colorMode} onSave={props.onSaveThemeConfiguration} onResetBuiltins={props.onResetBuiltinThemes} /><ThemeManager profiles={props.themeProfiles} onImport={props.onImportThemes} onCreateProfile={props.onCreateThemeProfile} onUpdateProfile={props.onUpdateThemeProfile} onDeleteProfile={props.onDeleteThemeProfile} onDeleteDefinition={props.onDeleteThemeDefinition} /></>
}
