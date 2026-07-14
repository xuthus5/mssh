import type { Terminal } from '@xterm/xterm'
import { logger } from '@/lib/logger'
import { createCopyOnSelectController } from '@/lib/terminalInteractions'
import { useTerminalBehaviorStore } from '@/store/terminalBehaviorStore'

export function installTerminalCopyOnSelect(term: Terminal, label: string): () => void {
  const controller = createCopyOnSelectController(term, {
    onError: (error: unknown) => logger.error(`${label} automatic selection copy failed`, error),
  })
  controller.setEnabled(useTerminalBehaviorStore.getState().copyOnSelect)
  const unsubscribe = useTerminalBehaviorStore.subscribe((state, previous) => {
    if (state.copyOnSelect !== previous.copyOnSelect) controller.setEnabled(state.copyOnSelect)
  })
  let disposed = false

  return () => {
    if (disposed) return
    disposed = true
    unsubscribe()
    controller.dispose()
  }
}
