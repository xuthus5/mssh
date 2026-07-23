import { CommandHistoryService } from '@/lib/wails'
import { logger } from '@/lib/logger'

export interface CommandHistoryEntry { id: string; command: string; createdAt: number }

export interface CommandHistoryLimits {
  maxEntries: number
  maxBytes: number
}

const prefix = 'mssh:command-history:'
const defaultLimits: CommandHistoryLimits = { maxEntries: 500, maxBytes: 256 * 1024 }

export function getCommandHistoryLimits(): CommandHistoryLimits {
  return { ...defaultLimits }
}

function estimateBytes(entries: CommandHistoryEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.command.length * 2 + 48, 0)
}

export function trimCommandHistory(
  entries: CommandHistoryEntry[],
  limits: CommandHistoryLimits = defaultLimits,
): CommandHistoryEntry[] {
  let next = entries.slice(0, Math.max(1, limits.maxEntries))
  while (next.length > 1 && estimateBytes(next) > limits.maxBytes) next = next.slice(0, -1)
  if (estimateBytes(next) > limits.maxBytes) return []
  return next
}

export function readCommandHistory(sessionID: number): CommandHistoryEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(`${prefix}${sessionID}`) ?? '[]') as CommandHistoryEntry[]
    return Array.isArray(parsed) ? trimCommandHistory(parsed) : []
  } catch {
    return []
  }
}

// Bare "-p" is intentionally not sensitive (common CLI short flags). DB tools still match below.
const sensitiveCommandPatterns: RegExp[] = [
  /(^|\s)(password|passwd|token|secret|--password|--passwd)(=|\s|$)/i,
  /(curl|wget).*\s(-H|--header)\s+['"]?authorization/i,
  /export\s+\w*(KEY|TOKEN|SECRET|PASSWORD|PASSWD)\w*=/i,
  /(^|\s)(mysql|psql|mongo|redis-cli)\b.*\s(-p|--password)(=|\S|$)/i,
  /(^|\s)sshpass\s+-p\s+/i,
  /(^|\s)(AWS_|GITHUB_|GH_|OPENAI_|ANTHROPIC_)[A-Z0-9_]*(=|\s)/i,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/i,
]

export function isSensitiveCommand(command: string): boolean {
  const value = command.trim()
  if (!value) return false
  return sensitiveCommandPatterns.some((pattern) => pattern.test(value))
}

export function recordCommand(sessionID: number, command: string, limits: CommandHistoryLimits = defaultLimits): void {
  const value = command.trim()
  if (!value || isSensitiveCommand(value)) return
  const persist = CommandHistoryService?.Add
  if (sessionID > 0 && typeof persist === 'function') {
    void persist(sessionID, value).catch((error: unknown) => logger.error('command history persistence failed', error))
  }
  const entries = readCommandHistory(sessionID)
  entries.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, command: value, createdAt: Date.now() })
  localStorage.setItem(`${prefix}${sessionID}`, JSON.stringify(trimCommandHistory(entries, limits)))
}

export async function clearCommandHistory(sessionID: number): Promise<void> {
  if (sessionID > 0 && typeof CommandHistoryService?.Clear === 'function') {
    await CommandHistoryService.Clear(sessionID)
  }
  localStorage.removeItem(`${prefix}${sessionID}`)
}
