import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs'
import { GeneralSettingsPanel } from '@/components/settings/GeneralSettingsPanel'
import { ThemeEditor } from '@/components/settings/ThemeEditor'
import { ThemeManager } from '@/components/settings/ThemeManager'
import { KeyManager } from '@/components/settings/KeyManager'
import { SyncPanel } from '@/components/settings/SyncPanel'
import type { GeneralSettings, KeyInfo, SyncConfig } from '@/hooks/useSettings'
import type { ColorMode } from '@/lib/effectiveTerminalTheme'
import type { BuiltinThemeResetResult, TerminalGlobalStyle, ThemeAssignments, ThemeConfigurationInput, ThemeImportSummary, ThemeProfile, ThemeProfileInput } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { useDraggableDialog } from '@/hooks/useDraggableDialog'
import { AboutPanel } from '@/components/settings/AboutPanel'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  general: GeneralSettings
  systemFonts: string[]
  themeProfiles: ThemeProfile[]
  themeAssignments: ThemeAssignments
  terminalGlobalStyle: TerminalGlobalStyle
  colorMode: ColorMode
  keys: KeyInfo[]
  sync: SyncConfig
  onSaveGeneral: (s: GeneralSettings) => Promise<void>
  onPreviewUIFont: (fontFamily: string, fallbackFamily: string, fontSize: number) => void
  onRestoreUIFont: () => void
  onPreviewWindowOpacity: (opacity: number) => void
  onRestoreWindowOpacity: () => void
  onSaveThemeConfiguration: (configuration: ThemeConfigurationInput) => Promise<void>
  onImportThemes: (paths: string[]) => Promise<ThemeImportSummary>
  onCreateThemeProfile: (profile: ThemeProfileInput) => Promise<ThemeProfile | null>
  onUpdateThemeProfile: (profile: ThemeProfileInput) => Promise<void>
  onDeleteThemeProfile: (id: number) => Promise<void>
  onDeleteThemeDefinition: (id: number) => Promise<void>
  onResetBuiltinThemes: () => Promise<BuiltinThemeResetResult>
  onGenerateKey: (name: string, type: KeyInfo['type'], bits: number) => void
  onImportKey: (name: string, privateKey: string) => void
  onDeleteKey: (id: string) => void
  onExportKey: (id: string) => Promise<string | undefined>
  onSaveSync: (c: SyncConfig) => void
  onExportConfig: () => void
  onImportConfig: () => void
}

function SettingsTabPanels(props: Props & { onDirtyChange: (dirty: boolean) => void }) {
  return <>
    <TabsContent value="general" className="min-h-0 min-w-0 overflow-y-auto overscroll-contain pr-2"><GeneralSettingsPanel general={props.general} systemFonts={props.systemFonts} onSave={props.onSaveGeneral} onPreviewUIFont={props.onPreviewUIFont} onPreviewWindowOpacity={props.onPreviewWindowOpacity} onDirtyChange={props.onDirtyChange} /></TabsContent>
    <TabsContent value="terminal" className="min-h-0 min-w-0 overflow-y-auto overscroll-contain pr-2"><div className="flex flex-col gap-5"><ThemeEditor profiles={props.themeProfiles} assignments={props.themeAssignments} globalStyle={props.terminalGlobalStyle} colorMode={props.colorMode} onSave={props.onSaveThemeConfiguration} onResetBuiltins={props.onResetBuiltinThemes} /><ThemeManager profiles={props.themeProfiles} onImport={props.onImportThemes} onCreateProfile={props.onCreateThemeProfile} onUpdateProfile={props.onUpdateThemeProfile} onDeleteProfile={props.onDeleteThemeProfile} onDeleteDefinition={props.onDeleteThemeDefinition} /></div></TabsContent>
    <TabsContent value="keys" className="min-h-0 min-w-0 overflow-y-auto overscroll-contain pr-2"><KeyManager keys={props.keys} onGenerate={props.onGenerateKey} onImport={props.onImportKey} onDelete={props.onDeleteKey} onExport={props.onExportKey} /></TabsContent>
    <TabsContent value="sync" className="min-h-0 min-w-0 overflow-y-auto overscroll-contain pr-2"><SyncPanel sync={props.sync} onSave={props.onSaveSync} onExport={props.onExportConfig} onImport={props.onImportConfig} /></TabsContent>
    <TabsContent value="about" className="min-h-0 min-w-0 overflow-y-auto overscroll-contain pr-2"><AboutPanel /></TabsContent>
  </>
}

function SettingsTabs(props: Props & { onDirtyChange: (dirty: boolean) => void }) {
  const [tab, setTab] = useState('general')
  return <Tabs value={tab} onValueChange={setTab} orientation="vertical" className="min-h-0 flex-1 flex-row gap-4 overflow-hidden">
    <TabsList className="w-36 shrink-0 self-stretch justify-start rounded-xl border bg-muted/40 p-2"><TabsTrigger value="general">通用</TabsTrigger><TabsTrigger value="terminal">终端</TabsTrigger><TabsTrigger value="keys">密钥</TabsTrigger><TabsTrigger value="sync">同步</TabsTrigger><TabsTrigger value="about">关于</TabsTrigger></TabsList>
    <SettingsTabPanels {...props} />
  </Tabs>
}

export default function SettingsDialog(props: Props) {
  const [previewDirty, setPreviewDirty] = useState(false)
  const draggable = useDraggableDialog(props.open)
  const handleOpenChange = (open: boolean) => {
    if (!open && previewDirty) {
      props.onRestoreUIFont()
      props.onRestoreWindowOpacity()
    }
    props.onOpenChange(open)
  }
  return <Dialog open={props.open} onOpenChange={handleOpenChange}>
    <DialogContent ref={draggable.contentRef} className="flex h-[min(720px,calc(100dvh-3rem))] max-h-[calc(100dvh-3rem)] flex-col overflow-hidden sm:max-w-5xl">
      <DialogHeader data-testid="settings-drag-handle" {...draggable.dragHandleProps} className="-mx-4 -mt-4 cursor-move touch-none select-none rounded-t-xl border-b border-border px-4 py-3 active:cursor-grabbing"><DialogTitle>设置</DialogTitle></DialogHeader>
      <SettingsTabs {...props} onDirtyChange={setPreviewDirty} />
    </DialogContent>
  </Dialog>
}
