import { SettingsView, type SettingsViewProps } from '@/components/settings/SettingsView'
import { SettingsWindowTitleBar } from '@/components/settings/SettingsWindowTitleBar'
import { ToastContainer } from '@/components/ui/toast'
import { useSettings } from '@/hooks/useSettings'
import { useCloudSyncCenter } from '@/hooks/useCloudSyncCenter'
import { useThemeCatalog } from '@/hooks/useThemeCatalog'

function settingsViewProps(
  settings: ReturnType<typeof useSettings>,
  catalog: ReturnType<typeof useThemeCatalog>,
  cloudSync: ReturnType<typeof useCloudSyncCenter>,
): SettingsViewProps {
  return {
    general: settings.general, systemFonts: settings.systemFonts, cloudSync,
    themeProfiles: catalog.profiles, themeAssignments: catalog.assignments, terminalGlobalStyle: catalog.globalStyle,
    colorMode: catalog.colorMode, onSaveGeneral: settings.saveGeneral, onPreviewUIFont: settings.previewUIFont,
    onPreviewWindowOpacity: settings.previewWindowOpacity, onSaveThemeConfiguration: catalog.saveConfiguration,
    onImportThemes: catalog.importThemes, onCreateThemeProfile: catalog.createProfile, onUpdateThemeProfile: catalog.saveProfile,
    onDeleteThemeProfile: catalog.deleteProfile, onDeleteThemeDefinition: catalog.deleteDefinition,
    onResetBuiltinThemes: catalog.resetBuiltinStyles,
    onExportConfig: settings.exportConfig, onImportConfig: settings.importConfig,
    sftpSettings: settings.sftpSettings, onSaveSFTPSettings: settings.saveSFTPSettings,
  }
}

export function SettingsWindowApp() {
  const settings = useSettings()
  const catalog = useThemeCatalog()
  const cloudSync = useCloudSyncCenter()
  return <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
    <SettingsWindowTitleBar />
    <SettingsView {...settingsViewProps(settings, catalog, cloudSync)} />
    <ToastContainer />
  </div>
}
