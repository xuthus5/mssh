import { useState, type ReactNode } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { GeneralSettingsPanel } from '@/components/settings/GeneralSettingsPanel'
import { TerminalSettingsPanel } from '@/components/settings/TerminalSettingsPanel'
import { SyncPanel } from '@/components/settings/SyncPanel'
import { AboutPanel } from '@/components/settings/AboutPanel'
import { ShortcutSettingsPanel } from '@/components/settings/ShortcutSettingsPanel'
import { SecurityPanel } from '@/components/settings/SecurityPanel'
import { SFTPSettingsPanel } from '@/components/settings/SFTPSettingsPanel'
import { AISettingsPanel } from '@/components/settings/AISettingsPanel'
import type { AISettingsController } from '@/hooks/useAISettings'
import type { SFTPSettings } from '@/hooks/useSFTPSettings'
import type { GeneralSettings, GeneralSettingsSaveOptions } from '@/hooks/useSettings'
import type { CloudSyncController } from '@/hooks/useCloudSyncCenter'
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

export interface SettingsViewProps {
  general: GeneralSettings
  settingsReady?: boolean
  loadError?: string
  onReloadSettings?: () => void
  themeLoadError?: string
  onReloadThemes?: () => void
  systemFonts: string[]
  themeProfiles: ThemeProfile[]
  themeAssignments: ThemeAssignments
  terminalGlobalStyle: TerminalGlobalStyle
  colorMode: ColorMode
  cloudSync: CloudSyncController
  onSaveGeneral: (settings: GeneralSettings, options?: GeneralSettingsSaveOptions) => Promise<void>
  onPreviewUIFont: (fontFamily: string, fallbackFamily: string, fontSize: number) => void
  onSaveThemeConfiguration: (configuration: ThemeConfigurationInput) => Promise<void>
  onImportThemes: (paths: string[]) => Promise<ThemeImportSummary>
  onCreateThemeProfile: (profile: ThemeProfileInput) => Promise<ThemeProfile | null>
  onUpdateThemeProfile: (profile: ThemeProfileInput) => Promise<void>
  onDeleteThemeProfile: (id: number) => Promise<void>
  onDeleteThemeDefinition: (id: number) => Promise<void>
  onResetBuiltinThemes: () => Promise<BuiltinThemeResetResult>
  onExportConfig: () => void | Promise<void>
  onImportConfig: () => void | Promise<void>
  sftpSettings: SFTPSettings
  sftpSettingsReady?: boolean
  sftpLoadError?: string
  onReloadSFTPSettings?: () => void
  onSaveSFTPSettings: (settings: SFTPSettings) => Promise<void>
  ai?: AISettingsController
}

const tabPanelClassName = 'min-h-0 min-w-0 overflow-y-auto overscroll-contain'

const settingsTabValues = ['general', 'terminal', 'ai', 'sync', 'security', 'sftp', 'shortcuts', 'about'] as const

type SettingsTab = typeof settingsTabValues[number]

interface SettingsTabPanelsProps extends SettingsViewProps {
  visitedTabs: ReadonlySet<SettingsTab>
}

function SettingsTabContent({ value, visitedTabs, children }: {
  value: SettingsTab
  visitedTabs: ReadonlySet<SettingsTab>
  children: ReactNode
}) {
  if (!visitedTabs.has(value)) return null
  return <TabsContent value={value} keepMounted className={tabPanelClassName}>{children}</TabsContent>
}

function PrimarySettingsTabPanels(props: SettingsTabPanelsProps) {
  return (
    <>
      <SettingsTabContent value="general" visitedTabs={props.visitedTabs}>
        <GeneralSettingsPanel
          general={props.general}
          systemFonts={props.systemFonts}
          onSave={props.onSaveGeneral}
          onPreviewUIFont={props.onPreviewUIFont}
          settingsReady={props.settingsReady}
          loadError={props.loadError}
          onReload={props.onReloadSettings}
        />
      </SettingsTabContent>
      <SettingsTabContent value="terminal" visitedTabs={props.visitedTabs}>
        <TerminalSettingsPanel
          general={props.general}
          themeProfiles={props.themeProfiles}
          themeAssignments={props.themeAssignments}
          terminalGlobalStyle={props.terminalGlobalStyle}
          colorMode={props.colorMode}
          onSaveGeneral={props.onSaveGeneral}
          onSaveThemeConfiguration={props.onSaveThemeConfiguration}
          onImportThemes={props.onImportThemes}
          onCreateThemeProfile={props.onCreateThemeProfile}
          onUpdateThemeProfile={props.onUpdateThemeProfile}
          onDeleteThemeProfile={props.onDeleteThemeProfile}
          onDeleteThemeDefinition={props.onDeleteThemeDefinition}
          onResetBuiltinThemes={props.onResetBuiltinThemes}
          settingsReady={props.settingsReady}
          loadError={props.loadError}
          onReloadSettings={props.onReloadSettings}
          themeLoadError={props.themeLoadError}
          onReloadThemes={props.onReloadThemes}
        />
      </SettingsTabContent>
    </>
  )
}

function SecondarySettingsTabPanels(props: SettingsTabPanelsProps) {
  return <>
      <SettingsTabContent value="ai" visitedTabs={props.visitedTabs}>
        {props.ai && <AISettingsPanel controller={props.ai} />}
      </SettingsTabContent>
      <SettingsTabContent value="sync" visitedTabs={props.visitedTabs}>
        <SyncPanel
          controller={props.cloudSync}
          onExport={props.onExportConfig}
          onImport={props.onImportConfig}
        />
      </SettingsTabContent>
      <SettingsTabContent value="security" visitedTabs={props.visitedTabs}>
        <SecurityPanel />
      </SettingsTabContent>
      <SettingsTabContent value="sftp" visitedTabs={props.visitedTabs}>
        <SFTPSettingsPanel
          settings={props.sftpSettings}
          onSave={props.onSaveSFTPSettings}
          settingsReady={props.sftpSettingsReady}
          loadError={props.sftpLoadError}
          onReload={props.onReloadSFTPSettings}
        />
      </SettingsTabContent>
      <SettingsTabContent value="shortcuts" visitedTabs={props.visitedTabs}>
        <ShortcutSettingsPanel />
      </SettingsTabContent>
      <SettingsTabContent value="about" visitedTabs={props.visitedTabs}>
        <AboutPanel />
      </SettingsTabContent>
  </>
}

function SettingsTabPanels(props: SettingsTabPanelsProps) {
  return <><PrimarySettingsTabPanels {...props} /><SecondarySettingsTabPanels {...props} /></>
}

export function SettingsView(props: SettingsViewProps) {
  const [tab, setTab] = useState<SettingsTab>('general')
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<SettingsTab>>(() => new Set(['general']))
  const selectTab = (value: SettingsTab) => {
    setVisitedTabs((current) => current.has(value) ? current : new Set([...current, value]))
    setTab(value)
  }
  return (
    <Tabs
      value={tab}
      onValueChange={selectTab}
      orientation="vertical"
      className="min-h-0 flex-1 gap-6 overflow-hidden p-6"
    >
      <TabsList className="w-44 shrink-0 justify-start overflow-visible rounded-xl border border-border bg-card p-1.5 shadow-sm">
        <TabsTrigger value="general">{t('通用')}</TabsTrigger>
        <TabsTrigger value="terminal">{t('终端')}</TabsTrigger>
        <TabsTrigger value="ai">AI</TabsTrigger>
        <TabsTrigger value="sync">{t('同步')}</TabsTrigger>
        <TabsTrigger value="security">{t('安全')}</TabsTrigger>
        <TabsTrigger value="sftp">SFTP</TabsTrigger>
        <TabsTrigger value="shortcuts">{t('快捷键')}</TabsTrigger>
        <TabsTrigger value="about">{t('关于')}</TabsTrigger>
      </TabsList>
      <SettingsTabPanels {...props} visitedTabs={visitedTabs} />
    </Tabs>
  )
}
