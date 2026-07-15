import { useGeneralSettings } from '@/hooks/useGeneralSettings'

export function GeneralSettingsRuntime() {
  useGeneralSettings()
  return null
}
