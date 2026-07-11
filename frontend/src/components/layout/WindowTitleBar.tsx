import { Minus, Square, X } from 'lucide-react'
import { Window } from '@wailsio/runtime'
import { logger } from '@/lib/logger'

function runWindowAction(name: string, action: () => Promise<unknown>) {
  void action().catch((error: unknown) => logger.error(`window ${name} failed`, error))
}

export function WindowTitleBar() {
  return <header className="flex h-9 shrink-0 select-none items-stretch border-b border-border bg-card">
    <div data-testid="window-drag-region" className="flex min-w-0 flex-1 items-center gap-2 px-3 [--wails-draggable:drag]" onDoubleClick={() => runWindowAction('toggle maximise', Window.ToggleMaximise)}>
      <span className="text-xs font-semibold tracking-wide text-foreground">MSSH</span>
      <span className="text-[11px] text-muted-foreground">Secure Shell Client</span>
    </div>
    <div className="flex [--wails-draggable:no-drag]">
      <button type="button" aria-label="最小化窗口" className="grid w-11 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={() => runWindowAction('minimise', Window.Minimise)}><Minus className="size-4" /></button>
      <button type="button" aria-label="最大化或还原窗口" className="grid w-11 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={() => runWindowAction('toggle maximise', Window.ToggleMaximise)}><Square className="size-3.5" /></button>
      <button type="button" aria-label="关闭窗口" className="grid w-11 place-items-center text-muted-foreground transition-colors hover:bg-destructive hover:text-white" onClick={() => runWindowAction('close', Window.Close)}><X className="size-4" /></button>
    </div>
  </header>
}
