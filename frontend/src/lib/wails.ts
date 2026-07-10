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

export function createLocalServices() {
  const folders: SessionFolder[] = []
  const sessions: SessionConfig[] = []
  const keys: KeyInfo[] = []
  const settings = new Map<string, string>()

  return {
    SessionService: {
      async ListFolders() { return [...folders] },
      async CreateFolder(name: string, parentId: number | null) {
        const f: SessionFolder = { id: Date.now(), name, parent_id: parentId }
        folders.push(f)
        return f
      },
      async UpdateFolder(_id: number, _name: string) {},
      async DeleteFolder(id: number) {
        const idx = folders.findIndex((f) => f.id === id)
        if (idx >= 0) folders.splice(idx, 1)
      },
      async ListSessions() { return [...sessions] },
      async CreateSession(s: Omit<SessionConfig, 'id'>) {
        const ns: SessionConfig = { ...s, id: Date.now() }
        sessions.push(ns)
        return ns
      },
      async UpdateSession(s: SessionConfig) {
        const i = sessions.findIndex((x) => x.id === s.id)
        if (i >= 0) sessions[i] = s
      },
      async DeleteSession(id: number) {
        const i = sessions.findIndex((x) => x.id === id)
        if (i >= 0) sessions.splice(i, 1)
      },
      async Connect(sessionId: number) { return `terminal-${sessionId}` },
      async Disconnect(_terminalId: string) {},
    },
    FileService: {
      async ListDir(_sid: number, _path: string): Promise<FileEntry[]> { return [] },
      async Upload(_sid: number, _src: string, _dst: string) { return 'task-1' },
      async Download(_sid: number, _src: string, _dst: string) { return 'task-1' },
      async CancelTransfer(_taskId: string) {},
      async Delete(_sid: number, _path: string) {},
      async Mkdir(_sid: number, _path: string) {},
      async Rename(_sid: number, _old: string, _n: string) {},
    },
    KeyService: {
      async List() { return [...keys] },
      async Generate(name: string, typ: string, _bits: number) {
        const k: KeyInfo = { id: Date.now(), name, type: typ as KeyInfo['type'], public_key: 'mock-pub', created_at: new Date().toISOString() }
        keys.push(k)
        return k
      },
      async Import(name: string, _pk: string) {
        const k: KeyInfo = { id: Date.now(), name, type: 'rsa', public_key: 'mock-pub', created_at: new Date().toISOString() }
        keys.push(k)
        return k
      },
      async Delete(id: number) {
        const i = keys.findIndex((k) => k.id === id)
        if (i >= 0) keys.splice(i, 1)
      },
      async ExportPublicKey(_id: number) { return 'mock-key' },
    },
    SettingsService: {
      async GetSetting(key: string) { return settings.get(key) ?? '' },
      async SetSetting(key: string, value: string) { settings.set(key, value) },
    },
    TerminalService: {
      async Write(_tid: string, _data: string) {},
      async Resize(_tid: string, _cols: number, _rows: number) {},
    },
    TunnelService: {
      async List() { return [] }, async Create(_t: unknown) { return {} }, async Update(_t: unknown) {},
      async Delete(_id: number) {}, async Start(_id: number) {}, async Stop(_id: number) {},
    },
    MacroService: {
      async List() { return [] }, async Create(_m: unknown) { return {} }, async Update(_m: unknown) {},
      async Delete(_id: number) {}, async Execute(_tid: string, _cmd: string) {},
    },
    ThemeService: {
      async List() { return [] }, async Create(_t: unknown) { return {} }, async Update(_t: unknown) {},
      async Delete(_id: number) {}, async GetActive() { return {} }, async SetActive(_id: number) {},
    },
    LogService: {
      async List(_sid: number) { return [] }, async StartRecording(_tid: string) {},
      async StopRecording(_tid: string) {}, async GetRecording(_logId: number) { return [] }, async Delete(_id: number) {},
    },
    SyncService: {
      async Export(_path: string) {}, async Import(_path: string) {},
    },
  }
}

export type WailsServices = ReturnType<typeof createLocalServices>

let _instance: WailsServices | null = null

export function getWails(): WailsServices {
  if (!_instance) {
    _instance = createLocalServices()
  }
  return _instance
}

export function setWailsServices(services: WailsServices) {
  _instance = services
}

export function resetWailsForTest() {
  _instance = null
}
