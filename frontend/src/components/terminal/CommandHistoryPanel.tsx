import { useEffect, useMemo, useState, type UIEvent } from 'react'
import { Clipboard, History, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { getClipboard } from '@/lib/clipboard'
import { clearCommandHistory, readCommandHistory, type CommandHistoryEntry } from '@/lib/commandHistory'
import { computeVirtualWindow } from '@/lib/virtualWindow'
import { CommandHistoryService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { useToolPanelResize } from '@/hooks/useToolPanelResize'
import { t } from '@/i18n'


const ROW_HEIGHT = 72

export function CommandHistoryPanel({
  sessionID,
  onClose,
  onFill,
}: {
  sessionID: number
  onClose: () => void
  onFill: (command: string) => void
}) {
  const panel = useToolPanelResize('history')
  const [entries, setEntries] = useState<CommandHistoryEntry[]>(() => readCommandHistory(sessionID))
  const [query, setQuery] = useState('')
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(360)

  useEffect(() => {
    // Local/serial history buckets use non-positive IDs and are localStorage-only.
    if (sessionID <= 0) {
      setEntries(readCommandHistory(sessionID))
      return
    }
    const load = async () => {
      try {
        const items = await CommandHistoryService.List(sessionID, '')
        setEntries((items ?? []).map((item: { id: number; command: string; created_at?: string; createdAt?: string }) => ({
          id: String(item.id),
          command: item.command,
          createdAt: Date.parse(item.created_at ?? item.createdAt ?? '') || Date.now(),
        })))
      } catch (error: unknown) {
        logger.error('command history loading failed', error)
      }
    }
    if (typeof CommandHistoryService?.List === 'function') void load()
  }, [sessionID])

  const filtered = useMemo(
    () => entries.filter((entry) => entry.command.toLowerCase().includes(query.toLowerCase())),
    [entries, query],
  )
  const windowed = computeVirtualWindow({
    count: filtered.length,
    estimateSize: ROW_HEIGHT,
    scrollOffset: scrollTop,
    viewportSize: viewportHeight,
    overscan: 6,
  })

  const copy = async (command: string) => {
    try {
      await getClipboard().writeText(command)
      toast(t('命令已复制'), 'success')
    } catch (error: unknown) {
      toast(t('复制失败: ${}', error instanceof Error ? error.message : String(error)), 'error')
    }
  }
  const clear = () => {
    clearCommandHistory(sessionID)
    setEntries([])
  }
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop)
    setViewportHeight(event.currentTarget.clientHeight)
  }

  return (
    <aside style={panel.panelStyle} className="absolute inset-y-0 right-0 z-20 flex flex-col border-l border-border bg-card shadow-xl" data-testid="command-history-panel">
      <div {...panel.resizeHandleProps} className="absolute inset-y-0 -left-1 z-30 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent hover:after:bg-primary/60 focus-visible:after:bg-primary active:after:bg-primary" />
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="flex items-center gap-2 text-sm font-medium"><History className="size-4" />{t('命令历史')}</span>
        <Button size="icon-xs" variant="ghost" aria-label={t('关闭历史')} onClick={onClose}><X /></Button>
      </div>
      <div className="flex gap-2 border-b border-border p-2">
        <Input placeholder={t('搜索历史命令...')} value={query} onChange={(event) => setQuery(event.target.value)} />
        <Button size="xs" variant="ghost" onClick={clear} disabled={entries.length === 0} title={t('清空历史')}><Trash2 /></Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2" onScroll={onScroll}>
        {filtered.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">{t('暂无命令历史')}</p>
        ) : (
          <div style={{ height: windowed.totalSize, position: 'relative' }}>
            {windowed.items.map((item) => {
              const entry = filtered[item.index]
              return (
                <div
                  key={entry.id}
                  className="group absolute left-0 right-0 rounded-md p-2 hover:bg-muted/60 focus-within:bg-muted/60"
                  style={{ top: item.start, height: item.size - 4 }}
                >
                  <code className="block whitespace-pre-wrap break-all text-xs">{entry.command}</code>
                  <div className="mt-1 flex justify-end gap-1 opacity-100 focus-within:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                    <Button size="xs" variant="ghost" onClick={() => { void copy(entry.command) }}><Clipboard />{t('复制')}</Button>
                    <Button size="xs" variant="ghost" onClick={() => onFill(entry.command)}>{t('填入终端')}</Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </aside>
  )
}
