import { Minus, Moon, Settings, Square, Sun, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Window } from '@wailsio/runtime'
import { logger } from '@/lib/logger'
import { SettingService } from '@/lib/wails'
import { toast } from '@/components/ui/toast'

function runWindowAction(name: string, action: () => Promise<unknown>) {
  void action().catch((error: unknown) => logger.error(`window ${name} failed`, error))
}

export function WindowTitleBar() {
  const [colorMode, setColorMode] = useState<'dark' | 'light'>(() => localStorage.getItem('mssh:color-mode') === 'light' ? 'light' : 'dark')

  useEffect(() => {
    document.documentElement.classList.toggle('light', colorMode === 'light')
  }, [colorMode])

  useEffect(() => {
    SettingService.Get('appearance.color_mode').then((setting) => {
      const savedMode = setting ? JSON.parse(setting.value) : null
      if (savedMode === 'light' || savedMode === 'dark') setColorMode(savedMode)
    }).catch((error: unknown) => logger.error('load colour mode failed', error))
  }, [])

  const toggleColorMode = () => {
    const nextMode = colorMode === 'dark' ? 'light' : 'dark'
    document.documentElement.classList.toggle('light', nextMode === 'light')
    localStorage.setItem('mssh:color-mode', nextMode)
    setColorMode(nextMode)
    void SettingService.Set({ key: 'appearance.color_mode', namespace: 'appearance', value: JSON.stringify(nextMode), value_type: 'string', version: 1 }).catch((error: unknown) => {
      document.documentElement.classList.toggle('light', colorMode === 'light')
      localStorage.setItem('mssh:color-mode', colorMode)
      setColorMode(colorMode)
      toast('主题设置保存失败，已恢复原主题', 'error')
      logger.error('save colour mode failed', error)
    })
  }

  return <header className="flex h-9 shrink-0 select-none items-stretch border-b border-border bg-card">
    <div data-testid="window-drag-region" className="flex min-w-0 flex-1 items-center gap-2 px-3 [--wails-draggable:drag]" onDoubleClick={() => runWindowAction('toggle maximise', Window.ToggleMaximise)}>
      <span className="text-xs font-semibold tracking-wide text-foreground">MSSH</span>
      <span className="text-[11px] text-muted-foreground">Secure Shell Client</span>
    </div>
    <div className="flex [--wails-draggable:no-drag]">
      <button type="button" aria-label={colorMode === 'dark' ? '切换到浅色模式' : '切换到深色模式'} className="grid w-10 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={toggleColorMode}>{colorMode === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}</button>
      <button type="button" aria-label="打开设置" className="grid w-10 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={() => window.dispatchEvent(new CustomEvent('mssh:open-settings'))}><Settings className="size-4" /></button>
      <span className="my-2 w-px bg-border" />
      <button type="button" aria-label="最小化窗口" className="grid w-11 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={() => runWindowAction('minimise', Window.Minimise)}><Minus className="size-4" /></button>
      <button type="button" aria-label="最大化或还原窗口" className="grid w-11 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={() => runWindowAction('toggle maximise', Window.ToggleMaximise)}><Square className="size-3.5" /></button>
      <button type="button" aria-label="关闭窗口" className="grid w-11 place-items-center text-muted-foreground transition-colors hover:bg-destructive hover:text-white" onClick={() => runWindowAction('close', Window.Close)}><X className="size-4" /></button>
    </div>
  </header>
}
