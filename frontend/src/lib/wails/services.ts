import { call as wcall } from './runtime'

const PKG = 'mssh/internal/service'

function call(methodName: string, ...args: unknown[]): Promise<unknown> {
  return wcall(-1, `${PKG}.${methodName}`, ...args)
}

// Use ByName via the Call namespace
async function rpc(method: string, ...args: unknown[]): Promise<unknown> {
  if (typeof window === 'undefined' || !window.wails) {
    throw new Error('Wails runtime not available')
  }
  const fqn = `${PKG}.${method}`
  return window.wails.Call.ByName(fqn, ...args)
}

export interface SessionFolder {
  id: number; name: string; parent_id: number | null
}

export interface SessionConfig {
  id: number; name: string; host: string; port: number; username: string
  auth_method: 'password' | 'key' | 'agent' | 'keyboard-interactive'
  password?: string; key_id?: number; keep_alive: number; term_type: string
  folder_id: number | null
}

export interface FileEntry {
  name: string; path: string; size: number; is_dir: boolean; mod_time: string
}

export interface KeyInfo {
  id: number; name: string; type: 'rsa' | 'ed25519' | 'ecdsa'
  public_key: string; created_at: string
}

export const SessionService = {
  ListFolders:    () => rpc('SessionService.ListFolders') as Promise<SessionFolder[]>,
  CreateFolder:   (name: string, parentId: number | null) => rpc('SessionService.CreateFolder', name, parentId) as Promise<SessionFolder>,
  UpdateFolder:   (id: number, name: string) => rpc('SessionService.UpdateFolder', id, name),
  DeleteFolder:   (id: number) => rpc('SessionService.DeleteFolder', id),
  MoveFolder:     (id: number, newParentId: number | null) => rpc('SessionService.MoveFolder', id, newParentId),
  ListSessions:   (folderId?: number | null) => rpc('SessionService.ListSessions', folderId ?? null) as Promise<SessionConfig[]>,
  CreateSession:  (s: Omit<SessionConfig, 'id'>) => rpc('SessionService.CreateSession', s) as Promise<SessionConfig>,
  UpdateSession:  (s: SessionConfig) => rpc('SessionService.UpdateSession', s),
  DeleteSession:  (id: number) => rpc('SessionService.DeleteSession', id),
  MoveSession:    (id: number, folderId: number | null) => rpc('SessionService.MoveSession', id, folderId),
  GetSession:     (id: number) => rpc('SessionService.GetSession', id) as Promise<SessionConfig>,
  Connect:        (sessionId: number) => rpc('SessionService.Connect', sessionId) as Promise<string>,
  Disconnect:     (terminalId: string) => rpc('SessionService.Disconnect', terminalId),
}

export const TerminalService = {
  Open:   (sessionId: number, cols: number, rows: number) => rpc('TerminalService.Open', sessionId, cols, rows) as Promise<string>,
  Write:  (terminalId: string, data: number[] | Uint8Array) => rpc('TerminalService.Write', terminalId, data),
  Resize: (terminalId: string, cols: number, rows: number) => rpc('TerminalService.Resize', terminalId, cols, rows),
  Close:  (terminalId: string) => rpc('TerminalService.Close', terminalId),
}

export const FileService = {
  ListDir:         (sessionId: number, path: string) => rpc('FileService.ListDir', sessionId, path) as Promise<FileEntry[]>,
  Upload:          (sessionId: number, src: string, dst: string) => rpc('FileService.Upload', sessionId, src, dst) as Promise<string>,
  Download:        (sessionId: number, src: string, dst: string) => rpc('FileService.Download', sessionId, src, dst) as Promise<string>,
  CancelTransfer:  (taskId: string) => rpc('FileService.CancelTransfer', taskId),
  Delete:          (sessionId: number, path: string) => rpc('FileService.Delete', sessionId, path),
  Mkdir:           (sessionId: number, path: string) => rpc('FileService.Mkdir', sessionId, path),
  Rename:          (sessionId: number, old: string, n: string) => rpc('FileService.Rename', sessionId, old, n),
}

export const KeyService = {
  List:             () => rpc('KeyService.List') as Promise<KeyInfo[]>,
  Generate:         (name: string, typ: string, bits: number) => rpc('KeyService.Generate', name, typ, bits) as Promise<KeyInfo>,
  Import:           (name: string, privateKey: string) => rpc('KeyService.Import', name, privateKey) as Promise<KeyInfo>,
  Delete:           (id: number) => rpc('KeyService.Delete', id),
  ExportPublicKey:  (id: number) => rpc('KeyService.ExportPublicKey', id) as Promise<string>,
}

export const SettingService = {
  GetSetting: (key: string) => rpc('SettingService.GetSetting', key) as Promise<string>,
  SetSetting: (key: string, value: string) => rpc('SettingService.SetSetting', key, value),
}

export const TunnelService = {
  List:     () => rpc('TunnelService.List') as Promise<unknown[]>,
  Create:   (t: unknown) => rpc('TunnelService.Create', t) as Promise<unknown>,
  Update:   (t: unknown) => rpc('TunnelService.Update', t),
  Delete:   (id: number) => rpc('TunnelService.Delete', id),
  Start:    (id: number) => rpc('TunnelService.Start', id),
  Stop:     (id: number) => rpc('TunnelService.Stop', id),
}

export const MacroService = {
  List:     () => rpc('MacroService.List') as Promise<unknown[]>,
  Create:   (m: unknown) => rpc('MacroService.Create', m) as Promise<unknown>,
  Update:   (m: unknown) => rpc('MacroService.Update', m),
  Delete:   (id: number) => rpc('MacroService.Delete', id),
  Execute:  (terminalId: string, command: string) => rpc('MacroService.Execute', terminalId, command),
}

export const ThemeService = {
  List:       () => rpc('ThemeService.List') as Promise<unknown[]>,
  Create:     (t: unknown) => rpc('ThemeService.Create', t) as Promise<unknown>,
  Update:     (t: unknown) => rpc('ThemeService.Update', t),
  Delete:     (id: number) => rpc('ThemeService.Delete', id),
  GetActive:  () => rpc('ThemeService.GetActive') as Promise<unknown>,
  SetActive:  (id: number) => rpc('ThemeService.SetActive', id),
}

export const LogService = {
  List:                     (sessionId: number) => rpc('LogService.List', sessionId) as Promise<unknown[]>,
  StartRecording:           (terminalId: string) => rpc('LogService.StartRecording', terminalId),
  StopRecording:            (terminalId: string) => rpc('LogService.StopRecording', terminalId),
  StartTerminalRecording:   (terminalId: string, sessionId: number, cols: number, rows: number, termType: string) =>
    rpc('LogService.StartTerminalRecording', terminalId, sessionId, cols, rows, termType) as Promise<number>,
  StopTerminalRecording:    (terminalId: string) => rpc('LogService.StopTerminalRecording', terminalId),
  GetRecording:             (logId: number) => rpc('LogService.GetRecording', logId) as Promise<unknown>,
  Delete:                   (id: number) => rpc('LogService.Delete', id),
}

export const SyncService = {
  Export: (path: string) => rpc('SyncService.Export', path),
  Import: (path: string) => rpc('SyncService.Import', path),
}
