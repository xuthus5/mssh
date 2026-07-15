import { X } from 'lucide-react'
import { Window } from '@wailsio/runtime'
import { Button } from '@/components/ui/button'
import { logger } from '@/lib/logger'

function closeWindow() {
  void Window.Close().catch((error: unknown) => logger.error('close settings window failed', error))
}

export function SettingsWindowTitleBar() {
  return <header className="flex h-12 shrink-0 select-none items-center border-b border-border bg-card px-4 [--wails-draggable:drag]">
    <h1 className="font-heading text-base font-medium text-foreground">设置</h1>
    <div className="flex-1" />
    <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭设置"
      className="[--wails-draggable:no-drag]" onClick={closeWindow}>
      <X className="size-4" />
    </Button>
  </header>
}
