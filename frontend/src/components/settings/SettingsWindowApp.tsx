import { useCallback } from 'react'
import { SettingsView, type SettingsViewProps } from '@/components/settings/SettingsView'
import { SettingsWindowTitleBar } from '@/components/settings/SettingsWindowTitleBar'
import { ToastContainer } from '@/components/ui/toast'
import { useSettings } from '@/hooks/useSettings'
import { useCloudSyncCenter } from '@/hooks/useCloudSyncCenter'
import { useThemeCatalog } from '@/hooks/useThemeCatalog'
import { useAISettings } from '@/hooks/useAISettings'
import { VaultGate } from '@/components/security/VaultGate'
import type { GeneralSettings } from '@/hooks/useSettings'
import type { SFTPSettings } from '@/hooks/useSFTPSettings'
import type { ThemeConfigurationInput } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

function settingsViewProps(
  settings: ReturnType<typeof useSettings>,
  catalog: ReturnType<typeof useThemeCatalog>,
  cloudSync: ReturnType<typeof useCloudSyncCenter>,
  ai: ReturnType<typeof useAISettings>,
  saveGeneralQuiet: (settings: GeneralSettings) => Promise<void>,
  saveSFTPQuiet: (settings: SFTPSettings) => Promise<void>,
  saveThemeQuiet: (configuration: ThemeConfigurationInput) => Promise<void>,
): SettingsViewProps {
  return {
    general: settings.general, systemFonts: settings.systemFonts, cloudSync,
    themeProfiles: catalog.profiles, themeAssignments: catalog.assignments, terminalGlobalStyle: catalog.globalStyle,
    colorMode: catalog.colorMode, onSaveGeneral: saveGeneralQuiet, onPreviewUIFont: settings.previewUIFont,
    onSaveThemeConfiguration: saveThemeQuiet,
    onImportThemes: catalog.importThemes, onCreateThemeProfile: catalog.createProfile, onUpdateThemeProfile: catalog.saveProfile,
    onDeleteThemeProfile: catalog.deleteProfile, onDeleteThemeDefinition: catalog.deleteDefinition,
    onResetBuiltinThemes: catalog.resetBuiltinStyles,
    onExportConfig: settings.exportConfig, onImportConfig: settings.importConfig,
    sftpSettings: settings.sftpSettings, onSaveSFTPSettings: saveSFTPQuiet,
    ai,
  }
}

function SettingsWindowContent() {
  const settings = useSettings()
  const catalog = useThemeCatalog()
  const cloudSync = useCloudSyncCenter()
  const ai = useAISettings()
  const saveGeneralQuiet = useCallback(
    (value: GeneralSettings) => settings.saveGeneral(value, { quiet: true }),
    [settings.saveGeneral],
  )
  const saveSFTPQuiet = useCallback(
    (value: SFTPSettings) => settings.saveSFTPSettings(value, { quiet: true }),
    [settings.saveSFTPSettings],
  )
  const saveThemeQuiet = useCallback(
    async (configuration: ThemeConfigurationInput) => {
      await catalog.saveConfiguration(configuration)
    },
    [catalog.saveConfiguration],
  )
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <SettingsWindowTitleBar />
      <SettingsView {...settingsViewProps(settings, catalog, cloudSync, ai, saveGeneralQuiet, saveSFTPQuiet, saveThemeQuiet)} />
      <ToastContainer />
    </div>
  )
}

export function SettingsWindowApp() {
  return (
    <VaultGate>
      <SettingsWindowContent />
    </VaultGate>
  )
}
