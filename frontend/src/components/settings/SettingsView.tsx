import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { GeneralSettingsPanel } from '@/components/settings/GeneralSettingsPanel'
import { ThemeEditor } from '@/components/settings/ThemeEditor'
import { ThemeManager } from '@/components/settings/ThemeManager'
import { KeyManager } from '@/components/settings/KeyManager'
import { SyncPanel } from '@/components/settings/SyncPanel'
import { AboutPanel } from '@/components/settings/AboutPanel'
import type { GeneralSettings, KeyImportFile, KeyInfo, KeyMaterial, SyncConfig } from '@/hooks/useSettings'
import type { ColorMode } from '@/lib/effectiveTerminalTheme'
import type { BuiltinThemeResetResult, TerminalGlobalStyle, ThemeAssignments, ThemeConfigurationInput, ThemeImportSummary, ThemeProfile, ThemeProfileInput } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

export interface SettingsViewProps {
  general: GeneralSettings
  systemFonts: string[]
  themeProfiles: ThemeProfile[]
  themeAssignments: ThemeAssignments
  terminalGlobalStyle: TerminalGlobalStyle
  colorMode: ColorMode
  keys: KeyInfo[]
  sync: SyncConfig
  onSaveGeneral: (settings: GeneralSettings) => Promise<void>
  onPreviewUIFont: (fontFamily: string, fallbackFamily: string, fontSize: number) => void
  onPreviewWindowOpacity: (opacity: number) => void
  onSaveThemeConfiguration: (configuration: ThemeConfigurationInput) => Promise<void>
  onImportThemes: (paths: string[]) => Promise<ThemeImportSummary>
  onCreateThemeProfile: (profile: ThemeProfileInput) => Promise<ThemeProfile | null>
  onUpdateThemeProfile: (profile: ThemeProfileInput) => Promise<void>
  onDeleteThemeProfile: (id: number) => Promise<void>
  onDeleteThemeDefinition: (id: number) => Promise<void>
  onResetBuiltinThemes: () => Promise<BuiltinThemeResetResult>
  onGenerateKey: (name: string, type: KeyInfo['type'], bits: number) => Promise<KeyMaterial | undefined>
  onImportKey: (name: string, privateKey: string) => Promise<KeyInfo | undefined>
  onDeleteKey: (id: string) => void
  onExportKey: (id: string) => Promise<string | undefined>
  onLoadKeyMaterial: (id: string) => Promise<KeyMaterial | undefined>
  onUpdateKey: (material: KeyMaterial) => Promise<KeyMaterial | undefined>
  onSelectKeyImportFile: () => Promise<KeyImportFile | undefined>
  onSaveSync: (config: SyncConfig) => void
  onExportConfig: () => void
  onImportConfig: () => void
}

function SettingsTabPanels(props: SettingsViewProps) {
  return <>
    <TabsContent value="general" className="min-h-0 min-w-0 overflow-y-auto overscroll-contain pr-2"><GeneralSettingsPanel general={props.general} systemFonts={props.systemFonts} onSave={props.onSaveGeneral} onPreviewUIFont={props.onPreviewUIFont} onPreviewWindowOpacity={props.onPreviewWindowOpacity} /></TabsContent>
    <TabsContent value="terminal" className="min-h-0 min-w-0 overflow-y-auto overscroll-contain pr-2"><div className="flex flex-col gap-5"><ThemeEditor profiles={props.themeProfiles} assignments={props.themeAssignments} globalStyle={props.terminalGlobalStyle} colorMode={props.colorMode} onSave={props.onSaveThemeConfiguration} onResetBuiltins={props.onResetBuiltinThemes} /><ThemeManager profiles={props.themeProfiles} onImport={props.onImportThemes} onCreateProfile={props.onCreateThemeProfile} onUpdateProfile={props.onUpdateThemeProfile} onDeleteProfile={props.onDeleteThemeProfile} onDeleteDefinition={props.onDeleteThemeDefinition} /></div></TabsContent>
    <TabsContent value="keys" className="min-h-0 min-w-0 overflow-y-auto overscroll-contain pr-2"><KeyManager keys={props.keys} onGenerate={props.onGenerateKey} onImport={props.onImportKey} onDelete={props.onDeleteKey} onExport={props.onExportKey} onLoadMaterial={props.onLoadKeyMaterial} onUpdate={props.onUpdateKey} onSelectImportFile={props.onSelectKeyImportFile} /></TabsContent>
    <TabsContent value="sync" className="min-h-0 min-w-0 overflow-y-auto overscroll-contain pr-2"><SyncPanel sync={props.sync} onSave={props.onSaveSync} onExport={props.onExportConfig} onImport={props.onImportConfig} /></TabsContent>
    <TabsContent value="about" className="min-h-0 min-w-0 overflow-y-auto overscroll-contain pr-2"><AboutPanel /></TabsContent>
  </>
}

export function SettingsView(props: SettingsViewProps) {
  const [tab, setTab] = useState('general')
  return <Tabs value={tab} onValueChange={setTab} orientation="vertical"
    className="min-h-0 flex-1 flex-row gap-4 overflow-hidden p-4">
    <TabsList className="w-36 shrink-0 self-stretch justify-start rounded-xl border bg-muted/40 p-2">
      <TabsTrigger value="general">通用</TabsTrigger>
      <TabsTrigger value="terminal">终端</TabsTrigger>
      <TabsTrigger value="keys">密钥</TabsTrigger>
      <TabsTrigger value="sync">同步</TabsTrigger>
      <TabsTrigger value="about">关于</TabsTrigger>
    </TabsList>
    <SettingsTabPanels {...props} />
  </Tabs>
}
