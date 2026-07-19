export type SFTPDefaultView = 'list' | 'tree'

export interface SFTPSettings {
  showHiddenFiles: boolean
  followTerminalDirectory: boolean
  defaultView: SFTPDefaultView
}

export const DEFAULT_SFTP_SETTINGS: SFTPSettings = {
  showHiddenFiles: false,
  followTerminalDirectory: false,
  defaultView: 'list',
}
