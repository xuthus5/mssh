import { create } from 'zustand'
import type { SFTPSettings } from '@/lib/sftpSettings'
import { DEFAULT_SFTP_SETTINGS } from '@/lib/sftpSettings'

interface SFTPSettingsState extends SFTPSettings {
  setSettings: (settings: SFTPSettings) => void
}

export const useSFTPSettingsStore = create<SFTPSettingsState>((set) => ({
  ...DEFAULT_SFTP_SETTINGS,
  setSettings: (settings) => set(settings),
}))
