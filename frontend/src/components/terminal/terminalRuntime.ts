import type { TerminalRuntimeErrorReporter } from '@/components/terminal/TerminalErrorBoundary'

export function runTerminalRuntime(
  reportRuntimeError: TerminalRuntimeErrorReporter,
  source: string,
  operation: () => void,
): boolean {
  try {
    operation()
    return true
  } catch (error: unknown) {
    reportRuntimeError(error, source)
    return false
  }
}
