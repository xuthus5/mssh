import { readCommandHistory } from '@/lib/commandHistory'

export const MAX_PREDICTION_TOKENS = 8

export type PredictionMode = 'prefix' | 'next' | 'command'

export interface TokenPrediction {
  tokens: string[]
  mode: PredictionMode
}

export function splitCommandTokens(line: string): string[] {
  return line.trim().split(/\s+/).filter((token) => token.length > 0)
}

function hasTrailingSpace(buffer: string): boolean {
  return /\s$/.test(buffer)
}

function matchesContext(tokens: string[], start: number, context: string[]): boolean {
  for (let index = 0; index < context.length; index++) {
    if (tokens[start + index] !== context[index]) return false
  }
  return true
}

/**
 * Collect full-command suffix candidates for a partial input line, newest first.
 * The history array is time-descending, so the first match wins per suffix.
 */
function collectCommandSuffixes(history: string[], buffer: string): string[] {
  const input = buffer.trim()
  if (!input) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const command of history) {
    const trimmed = command.trim()
    if (!trimmed.startsWith(input)) continue
    if (trimmed === input) continue
    const suffix = trimmed.slice(input.length).trim()
    if (!suffix || seen.has(suffix)) continue
    seen.add(suffix)
    result.push(suffix)
    if (result.length >= MAX_PREDICTION_TOKENS) break
  }
  return result
}

interface CandidateFilter {
  partial: string
  includeExact: boolean
}

function collectCandidates(history: string[], context: string[], filter: CandidateFilter): string[] {
  const { partial, includeExact } = filter
  const counts = new Map<string, number>()
  const firstIndex = new Map<string, number>()
  const record = (token: string, index: number) => {
    if (partial && !token.startsWith(partial)) return
    if (partial && !includeExact && token === partial) return
    if (!partial && token === (context[context.length - 1] ?? '')) return
    counts.set(token, (counts.get(token) ?? 0) + 1)
    if (!firstIndex.has(token)) firstIndex.set(token, index)
  }
  history.forEach((command, index) => {
    const tokens = splitCommandTokens(command)
    if (tokens.length === 0) return
    if (context.length === 0) {
      record(tokens[0], index)
      return
    }
    const limit = tokens.length - context.length - 1
    for (let start = 0; start <= limit; start++) {
      if (!matchesContext(tokens, start, context)) continue
      record(tokens[start + context.length], index)
    }
  })
  return [...counts.entries()]
    .map(([token, count]) => ({ token, count, index: firstIndex.get(token) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.index - b.index)
    .slice(0, MAX_PREDICTION_TOKENS)
    .map(({ token }) => token)
}

function isKnownCompleteToken(history: string[], context: string[], partial: string): boolean {
  if (!partial) return false
  return history.some((command) => {
    const tokens = splitCommandTokens(command)
    if (context.length === 0) return tokens[0] === partial
    if (tokens.length < context.length + 1) return false
    const limit = tokens.length - context.length - 1
    for (let start = 0; start <= limit; start++) {
      if (matchesContext(tokens, start, context) && tokens[start + context.length] === partial) return true
    }
    return false
  })
}

/** Predict next-token candidates for the current line from session history. */
export function predictCommandTokens(buffer: string, history: string[]): TokenPrediction {
  if (buffer.trim() === '') return { tokens: [], mode: 'next' }
  const trailing = hasTrailingSpace(buffer)
  const allTokens = splitCommandTokens(buffer)
  const context = trailing ? allTokens : allTokens.slice(0, -1)
  const partial = trailing ? '' : (allTokens[allTokens.length - 1] ?? '')

  if (!trailing && partial && context.length === 0 && !isKnownCompleteToken(history, [], partial)) {
    const commandSuffixes = collectCommandSuffixes(history, buffer)
    if (commandSuffixes.length > 0) return { tokens: commandSuffixes, mode: 'command' }
  }
  if (partial) {
    if (isKnownCompleteToken(history, context, partial)) {
      const next = collectCandidates(history, [...context, partial], { partial: '', includeExact: false })
      if (next.length > 0) return { tokens: next, mode: 'next' }
    }
    return { tokens: collectCandidates(history, context, { partial, includeExact: false }), mode: 'prefix' }
  }
  return { tokens: collectCandidates(history, context, { partial: '', includeExact: false }), mode: 'next' }
}

export function readSessionCommands(sessionID: number): string[] {
  if (!Number.isFinite(sessionID)) return []
  return readCommandHistory(sessionID).map((entry) => entry.command)
}
