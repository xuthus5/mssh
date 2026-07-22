import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { GeneralSettingsPanel } from '@/components/settings/GeneralSettingsPanel'
import { TerminalSettingsPanel } from '@/components/settings/TerminalSettingsPanel'
import { SyncPanel } from '@/components/settings/SyncPanel'
import { AboutPanel } from '@/components/settings/AboutPanel'
import { SecurityPanel } from '@/components/settings/SecurityPanel'
import { SFTPSettingsPanel } from '@/components/settings/SFTPSettingsPanel'
import { AISettingsPanel } from '@/components/settings/AISettingsPanel'
import type { AISettingsController } from '@/hooks/useAISettings'
import type { SFTPSettings } from '@/hooks/useSFTPSettings'
import type { GeneralSettings } from '@/hooks/useSettings'
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
  systemFonts: string[]
  themeProfiles: ThemeProfile[]
  themeAssignments: ThemeAssignments
  terminalGlobalStyle: TerminalGlobalStyle
  colorMode: ColorMode
  cloudSync: CloudSyncController
  onSaveGeneral: (settings: GeneralSettings) => Promise<void>
  onPreviewUIFont: (fontFamily: string, fallbackFamily: string, fontSize: number) => void
  onSaveThemeConfiguration: (configuration: ThemeConfigurationInput) => Promise<void>
  onImportThemes: (paths: string[]) => Promise<ThemeImportSummary>
  onCreateThemeProfile: (profile: ThemeProfileInput) => Promise<ThemeProfile | null>
  onUpdateThemeProfile: (profile: ThemeProfileInput) => Promise<void>
  onDeleteThemeProfile: (id: number) => Promise<void>
  onDeleteThemeDefinition: (id: number) => Promise<void>
  onResetBuiltinThemes: () => Promise<BuiltinThemeResetResult>
  onExportConfig: () => void
  onImportConfig: () => void
  sftpSettings: SFTPSettings
  onSaveSFTPSettings: (settings: SFTPSettings) => Promise<void>
  ai?: AISettingsController
}

function SettingsTabPanels(props: SettingsViewProps) {
  return (
    <>
      <TabsContent value="general" className="min-h-0 min-w-0 overflow-y-auto overscroll-contain pr-2">
        <GeneralSettingsPanel
          general={props.general}
          systemFonts={props.systemFonts}
          onSave={props.onSaveGeneral}
          onPreviewUIFont={props.onPreviewUIFont}
        />
      </TabsContent>
      <TabsContent value="terminal" className="min-h-0 min-w-0 overflow-y-auto overscroll-contain pr-2">
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
        />
      </TabsContent>
      <TabsContent value="ai" className="min-h-0 min-w-0 overflow-y-auto overscroll-contain pr-2">
        {props.ai && <AISettingsPanel controller={props.ai} />}
      </TabsContent>
      <TabsContent value="sync" className="min-h-0 min-w-0 overflow-y-auto overscroll-contain pr-2">
        <SyncPanel
          controller={props.cloudSync}
          onExport={props.onExportConfig}
          onImport={props.onImportConfig}
        />
      </TabsContent>
      <TabsContent value="security" className="min-h-0 min-w-0 overflow-y-auto overscroll-contain pr-2">
        <SecurityPanel />
      </TabsContent>
      <TabsContent value="sftp" className="min-h-0 min-w-0 overflow-y-auto overscroll-contain pr-2">
        <SFTPSettingsPanel settings={props.sftpSettings} onSave={props.onSaveSFTPSettings} />
      </TabsContent>
      <TabsContent value="about" className="min-h-0 min-w-0 overflow-y-auto overscroll-contain pr-2">
        <AboutPanel />
      </TabsContent>
    </>
  )
}

export function SettingsView(props: SettingsViewProps) {
  const [tab, setTab] = useState('general')
  return (
    <Tabs
      value={tab}
      onValueChange={setTab}
      orientation="vertical"
      className="min-h-0 flex-1 flex-row gap-4 overflow-hidden p-4"
    >
      <TabsList className="w-36 shrink-0 justify-start overflow-visible rounded-xl border bg-muted/40 p-2">
        <TabsTrigger value="general">{t('通用')}</TabsTrigger>
        <TabsTrigger value="terminal">{t('终端')}</TabsTrigger>
        <TabsTrigger value="ai">AI</TabsTrigger>
        <TabsTrigger value="sync">{t('同步')}</TabsTrigger>
        <TabsTrigger value="security">{t('安全')}</TabsTrigger>
        <TabsTrigger value="sftp">SFTP</TabsTrigger>
        <TabsTrigger value="about">{t('关于')}</TabsTrigger>
      </TabsList>
      <SettingsTabPanels {...props} />
    </Tabs>
  )
}
