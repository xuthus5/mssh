import { SettingsView, type SettingsViewProps } from '@/components/settings/SettingsView'
import { SettingsWindowTitleBar } from '@/components/settings/SettingsWindowTitleBar'
import { ToastContainer } from '@/components/ui/toast'
import { useSettings } from '@/hooks/useSettings'
import { useThemeCatalog } from '@/hooks/useThemeCatalog'

function settingsViewProps(
  settings: ReturnType<typeof useSettings>,
  catalog: ReturnType<typeof useThemeCatalog>,
): SettingsViewProps {
  return {
    general: settings.general, systemFonts: settings.systemFonts, sync: settings.sync,
    themeProfiles: catalog.profiles, themeAssignments: catalog.assignments, terminalGlobalStyle: catalog.globalStyle,
    colorMode: catalog.colorMode, onSaveGeneral: settings.saveGeneral, onPreviewUIFont: settings.previewUIFont,
    onPreviewWindowOpacity: settings.previewWindowOpacity, onSaveThemeConfiguration: catalog.saveConfiguration,
    onImportThemes: catalog.importThemes, onCreateThemeProfile: catalog.createProfile, onUpdateThemeProfile: catalog.saveProfile,
    onDeleteThemeProfile: catalog.deleteProfile, onDeleteThemeDefinition: catalog.deleteDefinition,
    onResetBuiltinThemes: catalog.resetBuiltinStyles,
    onSaveSync: settings.saveSync, onExportConfig: settings.exportConfig, onImportConfig: settings.importConfig,
  }
}

export function SettingsWindowApp() {
  const settings = useSettings()
  const catalog = useThemeCatalog()
  return <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
    <SettingsWindowTitleBar />
    <SettingsView {...settingsViewProps(settings, catalog)} />
    <ToastContainer />
  </div>
}
