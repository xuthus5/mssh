import type { Session as BindingSession, Tunnel as BindingTunnel } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'

export type AssetColorToken = 'slate' | 'red' | 'orange' | 'amber' | 'yellow' | 'lime' | 'green' | 'teal' | 'cyan' | 'blue' | 'violet' | 'pink'

export interface AssetEnvironment { id: string; name: string; colorToken: AssetColorToken; sortOrder: number; sessionCount: number }
export interface AssetProject { id: string; name: string; code: string; description: string; sortOrder: number; sessionCount: number }
export interface AssetTag { id: string; name: string; colorToken: AssetColorToken; sessionCount: number }

export interface Folder {
  id: string
  name: string
  parentId: string | null
  isDefault: boolean
}

export interface Session {
  id: string
  name: string
  host: string
  port: number
  username: string
  tags?: AssetTag[]
  notes?: string
  environmentId?: string
  projectId?: string
  environment?: AssetEnvironment
  project?: AssetProject
  authMethod: 'password' | 'key' | 'agent' | 'keyboard-interactive'
  password?: string
  keyId?: string
  keepAlive: number
  termType: string
  folderId: string | null
  lastConnectedAt?: string
  connectionCount?: number
}

export interface Tunnel {
  id: string
  sessionId: string
  type: 'local' | 'remote' | 'dynamic'
  localAddress: string
  localPort: number
  remoteAddress: string
  remotePort: number
  running: boolean
}

export function mapFolder(folder: { id: number; name: string; parent_id: number | null; is_default: boolean }): Folder {
  return { id: String(folder.id), name: folder.name, parentId: folder.parent_id ? String(folder.parent_id) : null, isDefault: folder.is_default }
}

export function mapSession(session: BindingSession): Session {
  return {
    id: String(session.id), name: session.name, host: session.host, port: session.port, username: session.username,
    tags: (session.tags ?? []).map(mapTag), notes: session.notes,
    environmentId: session.environment_id != null ? String(session.environment_id) : undefined,
    projectId: session.project_id != null ? String(session.project_id) : undefined,
    environment: session.environment ? mapEnvironment(session.environment) : undefined,
    project: session.project ? mapProject(session.project) : undefined,
    authMethod: session.auth_method as Session['authMethod'], password: session.password,
    keyId: session.key_id != null ? String(session.key_id) : undefined, keepAlive: session.keep_alive,
    termType: session.term_type, folderId: session.folder_id != null ? String(session.folder_id) : null,
    lastConnectedAt: session.last_connected_at ?? undefined, connectionCount: session.connection_count,
  }
}

export function mapEnvironment(value: { id: number; name: string; color_token: string; sort_order: number; session_count: number }): AssetEnvironment {
  return { id: String(value.id), name: value.name, colorToken: value.color_token as AssetColorToken, sortOrder: value.sort_order, sessionCount: value.session_count }
}

export function mapProject(value: { id: number; name: string; code: string; description: string; sort_order: number; session_count: number }): AssetProject {
  return { id: String(value.id), name: value.name, code: value.code, description: value.description, sortOrder: value.sort_order, sessionCount: value.session_count }
}

export function mapTag(value: { id: number; name: string; color_token: string; session_count: number }): AssetTag {
  return { id: String(value.id), name: value.name, colorToken: value.color_token as AssetColorToken, sessionCount: value.session_count }
}

export function mapTunnel(tunnel: BindingTunnel): Tunnel {
  return {
    id: String(tunnel.id), sessionId: String(tunnel.session_id), type: tunnel.type as Tunnel['type'],
    localAddress: tunnel.local_host ?? '', localPort: tunnel.local_port,
    remoteAddress: tunnel.remote_host ?? '', remotePort: tunnel.remote_port, running: false,
  }
}
