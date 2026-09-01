import { isSplitLayoutSnapshot } from '@/components/terminal/splitLayout'

type RecordValue = Record<string, unknown>

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null
}

function validTitle(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function sanitizePlayback(value: RecordValue): RecordValue | null {
  if (typeof value.recordingPath !== 'string' || !value.recordingPath) return null
  return { type: 'playback', title: validTitle(value.title, 'Playback'), recordingPath: value.recordingPath }
}

function terminalKind(value: RecordValue): 'ssh' | 'local' | 'serial' | null {
  const kind = value.connectionKind ?? 'ssh'
  return kind === 'ssh' || kind === 'local' || kind === 'serial' ? kind : null
}

function validSessionID(value: unknown, kind: 'ssh' | 'local' | 'serial'): number | null {
  if (!Number.isSafeInteger(value)) return null
  const sessionID = Number(value)
  if (kind === 'ssh') return sessionID > 0 ? sessionID : null
  return sessionID === 0 ? sessionID : null
}

function copyTerminalOptionals(target: RecordValue, source: RecordValue, kind: 'ssh' | 'local' | 'serial') {
  if (Number.isSafeInteger(source.terminalInstance)) target.terminalInstance = source.terminalInstance
  if (source.toolPanel === null || source.toolPanel === 'files' || source.toolPanel === 'history'
    || source.toolPanel === 'system' || source.toolPanel === 'ai') target.toolPanel = source.toolPanel
  if (kind !== 'serial' && isSplitLayoutSnapshot(source.splitLayout)) target.splitLayout = source.splitLayout
  if (kind === 'ssh' && validConnectionInfo(source)) {
    target.connectionHost = source.connectionHost
    target.connectionPort = source.connectionPort
    target.connectionUsername = source.connectionUsername
  }
}

function validConnectionInfo(value: RecordValue): boolean {
  return typeof value.connectionHost === 'string' && value.connectionHost.length > 0
    && Number.isSafeInteger(value.connectionPort) && Number(value.connectionPort) > 0
    && typeof value.connectionUsername === 'string' && value.connectionUsername.length > 0
}

function sanitizeTerminal(value: RecordValue): RecordValue | null {
  const kind = terminalKind(value)
  if (!kind) return null
  const sessionID = validSessionID(value.sessionId, kind)
  if (sessionID === null) return null
  const fallback = kind === 'ssh' ? `Session ${sessionID}` : kind === 'local' ? 'Local Terminal' : 'Serial Terminal'
  const result: RecordValue = { type: 'terminal', title: validTitle(value.title, fallback), sessionId: sessionID }
  if (kind === 'local') result.connectionKind = 'local'
  if (kind === 'serial') {
    if (!Number.isSafeInteger(value.serialPortId) || Number(value.serialPortId) <= 0) return null
    result.connectionKind = 'serial'
    result.serialPortId = value.serialPortId
  }
  copyTerminalOptionals(result, value, kind)
  return result
}

function sanitizeTab(value: unknown): RecordValue | null {
  if (!isRecord(value)) return null
  if (value.type === 'playback') return sanitizePlayback(value)
  if (value.type === 'terminal') return sanitizeTerminal(value)
  return null
}

function recoverActive(value: unknown, indexMap: Map<number, number>): RecordValue | null {
  if (!isRecord(value)) return null
  if (value.type === 'workspace' && (value.id === 'overview' || value.id === 'sessions' || value.id === 'macros')) return value
  if (value.type !== 'tab' || !Number.isSafeInteger(value.index)) return null
  const index = indexMap.get(Number(value.index))
  return index === undefined ? null : { type: 'tab', index }
}

export function recoverWorkspaceSnapshot(value: unknown, currentVersion: number): unknown {
  if (!isRecord(value) || value.version !== currentVersion || !Array.isArray(value.tabs)) return value
  const indexMap = new Map<number, number>()
  const tabs: RecordValue[] = []
  for (let index = 0; index < value.tabs.length && tabs.length < 32; index++) {
    const tab = sanitizeTab(value.tabs[index])
    if (!tab) continue
    indexMap.set(index, tabs.length)
    tabs.push(tab)
  }
  return {
    version: currentVersion,
    tabs,
    active: recoverActive(value.active, indexMap),
    workspaceTab: value.workspaceTab === 'overview' || value.workspaceTab === 'macros' ? value.workspaceTab : 'sessions',
    overviewSection: value.overviewSection === 'keys' || value.overviewSection === 'tunnels'
      || value.overviewSection === 'serial' || value.overviewSection === 'audit' ? value.overviewSection : 'sessions',
  }
}
