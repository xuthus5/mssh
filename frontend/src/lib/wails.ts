import { isWails, onEvent } from './wails/runtime'
import {
  SessionService,
  TerminalService,
  FileService,
  KeyService,
  SettingService,
  TunnelService,
  MacroService,
  ThemeService,
  LogService,
  SyncService,
  type SessionFolder,
  type SessionConfig,
  type FileEntry,
  type KeyInfo,
} from './wails/services'

export {
  SessionService,
  TerminalService,
  FileService,
  KeyService,
  SettingService,
  TunnelService,
  MacroService,
  ThemeService,
  LogService,
  SyncService,
  isWails,
  onEvent,
}

export type { SessionFolder, SessionConfig, FileEntry, KeyInfo }
