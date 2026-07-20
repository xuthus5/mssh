import { SettingsView, type SettingsViewProps } from '@/components/settings/SettingsView'
import { SettingsWindowTitleBar } from '@/components/settings/SettingsWindowTitleBar'
import { ToastContainer } from '@/components/ui/toast'
import { useSettings } from '@/hooks/useSettings'
import { useCloudSyncCenter } from '@/hooks/useCloudSyncCenter'
import { useThemeCatalog } from '@/hooks/useThemeCatalog'
import { useAISettings } from '@/hooks/useAISettings'

function settingsViewProps(
  settings: ReturnType<typeof useSettings>,
  catalog: ReturnType<typeof useThemeCatalog>,
  cloudSync: ReturnType<typeof useCloudSyncCenter>,
  ai: ReturnType<typeof useAISettings>,
): SettingsViewProps {
  return {
    general: settings.general, systemFonts: settings.systemFonts, cloudSync,
    themeProfiles: catalog.profiles, themeAssignments: catalog.assignments, terminalGlobalStyle: catalog.globalStyle,
    colorMode: catalog.colorMode, onSaveGeneral: settings.saveGeneral, onPreviewUIFont: settings.previewUIFont,
    onSaveThemeConfiguration: catalog.saveConfiguration,
    onImportThemes: catalog.importThemes, onCreateThemeProfile: catalog.createProfile, onUpdateThemeProfile: catalog.saveProfile,
    onDeleteThemeProfile: catalog.deleteProfile, onDeleteThemeDefinition: catalog.deleteDefinition,
    onResetBuiltinThemes: catalog.resetBuiltinStyles,
    onExportConfig: settings.exportConfig, onImportConfig: settings.importConfig,
    sftpSettings: settings.sftpSettings, onSaveSFTPSettings: settings.saveSFTPSettings,
    ai,
  }
}

export function SettingsWindowApp() {
  const settings = useSettings()
  const catalog = useThemeCatalog()
  const cloudSync = useCloudSyncCenter()
  const ai = useAISettings()
  return <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
    <SettingsWindowTitleBar />
    <SettingsView {...settingsViewProps(settings, catalog, cloudSync, ai)} />
    <ToastContainer />
  </div>
}
