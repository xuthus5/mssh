import type { Terminal } from '@xterm/xterm'

export interface CopyOnSelectController {
  setEnabled: (enabled: boolean) => void
  dispose: () => void
}

async function writeTerminalSelection(term: Terminal, clipboard: Pick<Clipboard, 'writeText'>): Promise<boolean> {
  const selection = term.getSelection()
  if (!selection) return false
  await clipboard.writeText(selection)
  return true
}

export async function copyTerminalSelection(term: Terminal, clipboard: Pick<Clipboard, 'writeText'>): Promise<boolean> {
  term.focus()
  return writeTerminalSelection(term, clipboard)
}

export async function pasteClipboardIntoTerminal(term: Terminal, clipboard: Pick<Clipboard, 'readText'>): Promise<void> {
  term.focus()
  term.paste(await clipboard.readText())
}

export function selectAllTerminal(term: Terminal): void {
  term.focus()
  term.selectAll()
}

function reportCopyError(onError: ((error: unknown) => void) | undefined, error: unknown): void {
  try {
    onError?.(error)
  } catch (onErrorError: unknown) {
    void onErrorError
  }
}

export function createCopyOnSelectController(term: Terminal, options: {
  clipboard?: Pick<Clipboard, 'writeText'>
  delay?: number
  onError?: (error: unknown) => void
}): CopyOnSelectController {
  let enabled = false
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
  }
  const copy = () => {
    timer = undefined
    const clipboard = options.clipboard ?? navigator.clipboard
    void writeTerminalSelection(term, clipboard).catch((error: unknown) => reportCopyError(options.onError, error))
  }
  const schedule = () => {
    if (!enabled || disposed) return
    cancel()
    timer = setTimeout(copy, options.delay ?? 120)
  }
  const subscription = term.onSelectionChange(schedule)

  return {
    setEnabled: (value) => {
      if (disposed) return
      enabled = value
      if (!enabled) cancel()
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      cancel()
      subscription.dispose()
    },
  }
}
