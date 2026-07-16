export interface CommandHistoryEntry { id: string; command: string; createdAt: number }
const prefix = 'mssh:command-history:'
const limit = 10000

export function readCommandHistory(sessionID: number): CommandHistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(`${prefix}${sessionID}`) ?? '[]') as CommandHistoryEntry[] } catch { return [] }
}

export function recordCommand(sessionID: number, command: string): void {
  const value = command.trim()
  if (!value || /(^|\s)(password|passwd|token|secret|--password)(=|\s|$)/i.test(value)) return
  const entries = readCommandHistory(sessionID)
  entries.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, command: value, createdAt: Date.now() })
  localStorage.setItem(`${prefix}${sessionID}`, JSON.stringify(entries.slice(0, limit)))
}

export function clearCommandHistory(sessionID: number): void { localStorage.removeItem(`${prefix}${sessionID}`) }
