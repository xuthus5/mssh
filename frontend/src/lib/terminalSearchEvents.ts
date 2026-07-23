export const TERMINAL_SEARCH_TOGGLE_EVENT = 'mssh:toggle-terminal-search' as const

export function emitTerminalSearchToggle(): void {
  window.dispatchEvent(new CustomEvent(TERMINAL_SEARCH_TOGGLE_EVENT))
}
