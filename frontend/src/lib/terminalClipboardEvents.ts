/** Cross-component terminal clipboard failure channel (toolbar banner owner). */
export const TERMINAL_CLIPBOARD_ERROR_EVENT = 'mssh:terminal-clipboard-error' as const

export type TerminalClipboardErrorDetail = {
  terminalID: string | null
  message: string
}

/** Report a clipboard failure for the active/known terminal pane. */
export function reportTerminalClipboardError(message: string, terminalID?: string | null): void {
  window.dispatchEvent(new CustomEvent(TERMINAL_CLIPBOARD_ERROR_EVENT, {
    detail: { terminalID: terminalID ?? null, message } satisfies TerminalClipboardErrorDetail,
  }))
}
