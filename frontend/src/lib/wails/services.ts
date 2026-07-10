import { call } from './runtime'
import { MethodID } from './methodID'

export interface SessionFolder {
  id: number
  name: string
  parent_id: number | null
}

export interface SessionConfig {
  id: number
  name: string
  host: string
  port: number
  username: string
  auth_method: 'password' | 'key' | 'agent' | 'keyboard-interactive'
  password?: string
  key_id?: number
  keep_alive: number
  term_type: string
  folder_id: number | null
}

export interface FileEntry {
  name: string
  path: string
  size: number
  is_dir: boolean
  mod_time: string
}

export interface KeyInfo {
  id: number
  name: string
  type: 'rsa' | 'ed25519' | 'ecdsa'
  public_key: string
  created_at: string
}

export const SessionService = {
  ListFolders(): Promise<SessionFolder[]> {
    return call(MethodID.SessionService_ListFolders) as Promise<SessionFolder[]>
  },
  CreateFolder(name: string, parentId: number | null): Promise<SessionFolder> {
    return call(MethodID.SessionService_CreateFolder, name, parentId) as Promise<SessionFolder>
  },
  UpdateFolder(id: number, name: string): Promise<void> {
    return call(MethodID.SessionService_UpdateFolder, id, name) as Promise<void>
  },
  DeleteFolder(id: number): Promise<void> {
    return call(MethodID.SessionService_DeleteFolder, id) as Promise<void>
  },
  MoveFolder(id: number, newParentId: number | null): Promise<void> {
    return call(MethodID.SessionService_MoveFolder, id, newParentId) as Promise<void>
  },
  ListSessions(folderId?: number): Promise<SessionConfig[]> {
    return call(MethodID.SessionService_ListSessions, folderId ?? null) as Promise<SessionConfig[]>
  },
  CreateSession(session: Omit<SessionConfig, 'id'>): Promise<SessionConfig> {
    return call(MethodID.SessionService_CreateSession, session) as Promise<SessionConfig>
  },
  UpdateSession(session: SessionConfig): Promise<void> {
    return call(MethodID.SessionService_UpdateSession, session) as Promise<void>
  },
  DeleteSession(id: number): Promise<void> {
    return call(MethodID.SessionService_DeleteSession, id) as Promise<void>
  },
  MoveSession(id: number, folderId: number | null): Promise<void> {
    return call(MethodID.SessionService_MoveSession, id, folderId) as Promise<void>
  },
  GetSession(id: number): Promise<SessionConfig> {
    return call(MethodID.SessionService_GetSession, id) as Promise<SessionConfig>
  },
  Connect(sessionId: number): Promise<string> {
    return call(MethodID.SessionService_Connect, sessionId) as Promise<string>
  },
  Disconnect(terminalId: string): Promise<void> {
    return call(MethodID.SessionService_Disconnect, terminalId) as Promise<void>
  },
}

export const TerminalService = {
  Open(sessionId: number, cols: number, rows: number): Promise<string> {
    return call(MethodID.TerminalService_Open, sessionId, cols, rows) as Promise<string>
  },
  Write(terminalId: string, data: number[]): Promise<number> {
    return call(MethodID.TerminalService_Write, terminalId, data) as Promise<number>
  },
  Resize(terminalId: string, cols: number, rows: number): Promise<void> {
    return call(MethodID.TerminalService_Resize, terminalId, cols, rows) as Promise<void>
  },
  Close(terminalId: string): Promise<void> {
    return call(MethodID.TerminalService_Close, terminalId) as Promise<void>
  },
}

export const FileService = {
  ListDir(sessionId: number, path: string): Promise<FileEntry[]> {
    return call(MethodID.FileService_ListDir, sessionId, path) as Promise<FileEntry[]>
  },
  Upload(sessionId: number, localPath: string, remotePath: string): Promise<string> {
    return call(MethodID.FileService_Upload, sessionId, localPath, remotePath) as Promise<string>
  },
  Download(sessionId: number, remotePath: string, localPath: string): Promise<string> {
    return call(MethodID.FileService_Download, sessionId, remotePath, localPath) as Promise<string>
  },
  CancelTransfer(taskId: string): Promise<void> {
    return call(MethodID.FileService_CancelTransfer, taskId) as Promise<void>
  },
  Delete(sessionId: number, path: string): Promise<void> {
    return call(MethodID.FileService_Delete, sessionId, path) as Promise<void>
  },
  Mkdir(sessionId: number, path: string): Promise<void> {
    return call(MethodID.FileService_Mkdir, sessionId, path) as Promise<void>
  },
  Rename(sessionId: number, oldPath: string, newPath: string): Promise<void> {
    return call(MethodID.FileService_Rename, sessionId, oldPath, newPath) as Promise<void>
  },
}

export const KeyService = {
  List(): Promise<KeyInfo[]> {
    return call(MethodID.KeyService_List) as Promise<KeyInfo[]>
  },
  Generate(name: string, keyType: string, bits: number): Promise<KeyInfo> {
    return call(MethodID.KeyService_Generate, name, keyType, bits) as Promise<KeyInfo>
  },
  Import(name: string, privateKey: string): Promise<KeyInfo> {
    return call(MethodID.KeyService_Import, name, privateKey) as Promise<KeyInfo>
  },
  Delete(id: number): Promise<void> {
    return call(MethodID.KeyService_Delete, id) as Promise<void>
  },
  ExportPublicKey(id: number): Promise<string> {
    return call(MethodID.KeyService_ExportPublicKey, id) as Promise<string>
  },
}

export const SettingService = {
  GetSetting(key: string): Promise<string> {
    return call(MethodID.SettingService_GetSetting, key) as Promise<string>
  },
  SetSetting(key: string, value: string): Promise<void> {
    return call(MethodID.SettingService_SetSetting, key, value) as Promise<void>
  },
}

export const TunnelService = {
  List(): Promise<unknown[]> {
    return call(MethodID.TunnelService_List) as Promise<unknown[]>
  },
  Create(tunnel: unknown): Promise<unknown> {
    return call(MethodID.TunnelService_Create, tunnel) as Promise<unknown>
  },
  Update(tunnel: unknown): Promise<void> {
    return call(MethodID.TunnelService_Update, tunnel) as Promise<void>
  },
  Delete(id: number): Promise<void> {
    return call(MethodID.TunnelService_Delete, id) as Promise<void>
  },
  Start(id: number): Promise<void> {
    return call(MethodID.TunnelService_Start, id) as Promise<void>
  },
  Stop(id: number): Promise<void> {
    return call(MethodID.TunnelService_Stop, id) as Promise<void>
  },
}

export const MacroService = {
  List(): Promise<unknown[]> {
    return call(MethodID.MacroService_List) as Promise<unknown[]>
  },
  Create(macro: unknown): Promise<unknown> {
    return call(MethodID.MacroService_Create, macro) as Promise<unknown>
  },
  Update(macro: unknown): Promise<void> {
    return call(MethodID.MacroService_Update, macro) as Promise<void>
  },
  Delete(id: number): Promise<void> {
    return call(MethodID.MacroService_Delete, id) as Promise<void>
  },
  Execute(terminalId: string, command: string): Promise<void> {
    return call(MethodID.MacroService_Execute, terminalId, command) as Promise<void>
  },
}

export const ThemeService = {
  List(): Promise<unknown[]> {
    return call(MethodID.ThemeService_List) as Promise<unknown[]>
  },
  Create(theme: unknown): Promise<unknown> {
    return call(MethodID.ThemeService_Create, theme) as Promise<unknown>
  },
  Update(theme: unknown): Promise<void> {
    return call(MethodID.ThemeService_Update, theme) as Promise<void>
  },
  Delete(id: number): Promise<void> {
    return call(MethodID.ThemeService_Delete, id) as Promise<void>
  },
  GetActive(): Promise<string> {
    return call(MethodID.ThemeService_GetActive) as Promise<string>
  },
  SetActive(themeId: string): Promise<void> {
    return call(MethodID.ThemeService_SetActive, themeId) as Promise<void>
  },
}

export const LogService = {
  List(sessionId: number | null): Promise<unknown[]> {
    return call(MethodID.LogService_List, sessionId) as Promise<unknown[]>
  },
  StartRecording(sessionId: number, cols: number, rows: number, termType: string, dataPath: string): Promise<number> {
    return call(MethodID.LogService_StartRecording, sessionId, cols, rows, termType, dataPath) as Promise<number>
  },
  StopRecording(logId: number): Promise<void> {
    return call(MethodID.LogService_StopRecording, logId) as Promise<void>
  },
  GetRecording(path: string): Promise<unknown> {
    return call(MethodID.LogService_GetRecording, path) as Promise<unknown>
  },
  Delete(id: number): Promise<void> {
    return call(MethodID.LogService_Delete, id) as Promise<void>
  },
}

export const SyncService = {
  Export(path: string): Promise<void> {
    return call(MethodID.SyncService_Export, path) as Promise<void>
  },
  Import(path: string): Promise<void> {
    return call(MethodID.SyncService_Import, path) as Promise<void>
  },
}
