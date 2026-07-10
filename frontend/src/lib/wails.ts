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
import { MethodID } from './wails/methodID'

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
  MethodID,
}

export type { SessionFolder, SessionConfig, FileEntry, KeyInfo }
