/** Detect backend errors that mean the terminal session no longer exists. */
export function isTerminalGone(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /terminal not found|not found|closed|not available|no such terminal/i.test(message)
}
