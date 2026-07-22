import { readCommandHistory } from '@/lib/commandHistory'

/** Return the remainder to append so prefix becomes a historical command. */
export function findHistoryCompletion(prefix: string, history: string[]): string | null {
  const current = prefix
  if (!current.trim()) return null
  const seen = new Set<string>()
  for (const command of history) {
    if (!command || seen.has(command)) continue
    seen.add(command)
    if (command.startsWith(current) && command.length > current.length) {
      return command.slice(current.length)
    }
  }
  return null
}

export function suggestHistoryCompletion(prefix: string, sessionID: number): string | null {
  if (!Number.isFinite(sessionID)) return null
  const history = readCommandHistory(sessionID).map((entry) => entry.command)
  return findHistoryCompletion(prefix, history)
}
