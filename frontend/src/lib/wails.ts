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

export interface WailsSessionService {
  ListFolders(): Promise<SessionFolder[]>
  CreateFolder(name: string, parentId: number | null): Promise<SessionFolder>
  UpdateFolder(id: number, name: string): Promise<void>
  DeleteFolder(id: number): Promise<void>
  ListSessions(): Promise<SessionConfig[]>
  CreateSession(s: Omit<SessionConfig, 'id'>): Promise<SessionConfig>
  UpdateSession(s: SessionConfig): Promise<void>
  DeleteSession(id: number): Promise<void>
  Connect(sessionId: number): Promise<string>
  Disconnect(terminalId: string): Promise<void>
}

export interface WailsFileService {
  ListDir(sessionId: number, path: string): Promise<FileEntry[]>
  Upload(sessionId: number, src: string, dst: string): Promise<string>
  Download(sessionId: number, src: string, dst: string): Promise<string>
  CancelTransfer(taskId: string): Promise<void>
  Delete(sessionId: number, path: string): Promise<void>
  Mkdir(sessionId: number, path: string): Promise<void>
  Rename(sessionId: number, old: string, n: string): Promise<void>
}

export interface FileEntry {
  name: string
  path: string
  size: number
  is_dir: boolean
  mod_time: string
}

export interface WailsKeyService {
  List(): Promise<KeyInfo[]>
  Generate(name: string, typ: string, bits: number): Promise<KeyInfo>
  Import(name: string, privateKey: string): Promise<KeyInfo>
  Delete(id: number): Promise<void>
  ExportPublicKey(id: number): Promise<string>
}

export interface KeyInfo {
  id: number
  name: string
  type: 'rsa' | 'ed25519' | 'ecdsa'
  public_key: string
  created_at: string
}

export interface WailsSettingsService {
  GetSetting(key: string): Promise<string>
  SetSetting(key: string, value: string): Promise<void>
}

export interface WailsServices {
  SessionService: WailsSessionService
  FileService: WailsFileService
  KeyService: WailsKeyService
  SettingsService: WailsSettingsService
  TerminalService: {
    Write(terminalId: string, data: string): Promise<void>
    Resize(terminalId: string, cols: number, rows: number): Promise<void>
  }
  TunnelService: {
    List(): Promise<unknown[]>
    Create(t: unknown): Promise<unknown>
    Update(t: unknown): Promise<void>
    Delete(id: number): Promise<void>
    Start(id: number): Promise<void>
    Stop(id: number): Promise<void>
  }
  MacroService: {
    List(): Promise<unknown[]>
    Create(m: unknown): Promise<unknown>
    Update(m: unknown): Promise<void>
    Delete(id: number): Promise<void>
    Execute(terminalId: string, command: string): Promise<void>
  }
  ThemeService: {
    List(): Promise<unknown[]>
    Create(t: unknown): Promise<unknown>
    Update(t: unknown): Promise<void>
    Delete(id: number): Promise<void>
    GetActive(): Promise<unknown>
    SetActive(id: number): Promise<void>
  }
  LogService: {
    List(sessionId: number): Promise<unknown[]>
    StartRecording(terminalId: string): Promise<void>
    StopRecording(terminalId: string): Promise<void>
    GetRecording(logId: number): Promise<number[]>
    Delete(id: number): Promise<void>
  }
  SyncService: {
    Export(path: string): Promise<void>
    Import(path: string): Promise<void>
  }
}

let _wails: WailsServices | null = null

export function setWailsServices(services: WailsServices) {
  _wails = services
}

export function getWails(): WailsServices {
  if (!_wails) {
    throw new Error('Wails services not initialized. Call setWailsServices() first.')
  }
  return _wails
}

export function createMockWailsServices(): WailsServices {
  const folders: SessionFolder[] = []
  const sessions: SessionConfig[] = []
  const keys: KeyInfo[] = []
  const settings = new Map<string, string>()

  return {
    SessionService: {
      async ListFolders() { return [...folders] },
      async CreateFolder(name, parentId) {
        const f: SessionFolder = { id: folders.length + 1, name, parent_id: parentId ?? null }
        folders.push(f)
        return f
      },
      async UpdateFolder(id, name) {
        const f = folders.find((x) => x.id === id)
        if (f) f.name = name
      },
      async DeleteFolder(id) {
        const idx = folders.findIndex((x) => x.id === id)
        if (idx >= 0) folders.splice(idx, 1)
      },
      async ListSessions() { return [...sessions] },
      async CreateSession(s) {
        const ns: SessionConfig = { ...s, id: sessions.length + 1 }
        sessions.push(ns)
        return ns
      },
      async UpdateSession(s) {
        const i = sessions.findIndex((x) => x.id === s.id)
        if (i >= 0) sessions[i] = s
      },
      async DeleteSession(id) {
        const i = sessions.findIndex((x) => x.id === id)
        if (i >= 0) sessions.splice(i, 1)
      },
      async Connect(sessionId) { return `terminal-${sessionId}` },
      async Disconnect(_terminalId) {},
    },

    FileService: {
      async ListDir(_sid, _path) { return [] },
      async Upload(_sid, _src, _dst) { return 'task-u-1' },
      async Download(_sid, _src, _dst) { return 'task-d-1' },
      async CancelTransfer(_taskId) {},
      async Delete(_sid, _path) {},
      async Mkdir(_sid, _path) {},
      async Rename(_sid, _old, _n) {},
    },

    KeyService: {
      async List() { return [...keys] },
      async Generate(name, typ, bits) {
        const k: KeyInfo = { id: keys.length + 1, name, type: typ as KeyInfo['type'], public_key: 'mock-pub', created_at: new Date().toISOString() }
        keys.push(k)
        return k
      },
      async Import(name, _pk) {
        const k: KeyInfo = { id: keys.length + 1, name, type: 'rsa', public_key: 'mock-pub', created_at: new Date().toISOString() }
        keys.push(k)
        return k
      },
      async Delete(id) {
        const i = keys.findIndex((x) => x.id === id)
        if (i >= 0) keys.splice(i, 1)
      },
      async ExportPublicKey(_id) { return 'mock-public-key' },
    },

    SettingsService: {
      async GetSetting(key) { return settings.get(key) ?? '' },
      async SetSetting(key, value) { settings.set(key, value) },
    },

    TerminalService: {
      async Write(_tid, _data) {},
      async Resize(_tid, _cols, _rows) {},
    },

    TunnelService: {
      async List() { return [] },
      async Create(_t) { return {} },
      async Update(_t) {},
      async Delete(_id) {},
      async Start(_id) {},
      async Stop(_id) {},
    },

    MacroService: {
      async List() { return [] },
      async Create(_m) { return {} },
      async Update(_m) {},
      async Delete(_id) {},
      async Execute(_tid, _cmd) {},
    },

    ThemeService: {
      async List() { return [] },
      async Create(_t) { return {} },
      async Update(_t) {},
      async Delete(_id) {},
      async GetActive() { return {} },
      async SetActive(_id) {},
    },

    LogService: {
      async List(_sid) { return [] },
      async StartRecording(_tid) {},
      async StopRecording(_tid) {},
      async GetRecording(_logId) { return [] },
      async Delete(_id) {},
    },

    SyncService: {
      async Export(_path) {},
      async Import(_path) {},
    },
  }
}
