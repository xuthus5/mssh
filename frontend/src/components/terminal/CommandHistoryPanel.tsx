import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import { Clipboard, History, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { getClipboard } from '@/lib/clipboard'
import { clearCommandHistory, readCommandHistory, type CommandHistoryEntry } from '@/lib/commandHistory'
import { requestConfirm } from '@/lib/confirmDialog'
import { computeVirtualWindow } from '@/lib/virtualWindow'
import { CommandHistoryService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { useToolPanelResize } from '@/hooks/useToolPanelResize'
import { t } from '@/i18n'
import { isOperationBusyError } from '@/lib/operationBusyError'
import {
  onCommandHistoryChanged,
  runCommandHistoryMutation,
  useCommandHistoryMutationState,
} from '@/lib/commandHistoryMutationCoordinator'


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
  const runtime = useHistoryRuntime()
  const source = useRef(Symbol('command-history-panel')).current
  const history = useHistoryEntries(sessionID, runtime, source)
  const feedback = useHistoryFeedback(runtime, sessionID)
  const clear = useClearHistory({ sessionID, runtime, history, feedback, source })
  const virtual = useVirtualHistory(history.entries)
  return <aside style={panel.panelStyle} className="absolute inset-y-0 right-0 z-20 flex flex-col border-l border-border bg-card shadow-xl" data-testid="command-history-panel">
    <div {...panel.resizeHandleProps} className="absolute inset-y-0 -left-1 z-30 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent hover:after:bg-primary/60 focus-visible:after:bg-primary active:after:bg-primary" />
    <HistoryPanelHeader disabled={clear.clearing} onClose={onClose} />
    <HistoryPanelToolbar virtual={virtual} clear={clear} entryCount={history.entries.length} />
    {feedback.actionError ? <div className="border-b border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">{feedback.actionError}</div> : null}
    <HistoryPanelList virtual={virtual} loadError={history.loadError} onCopy={feedback.copy} onFill={onFill} />
  </aside>
}

function useHistoryRuntime() {
  const lifecycle = useRef(0)
  const generation = useRef(0)
  const loadRequest = useRef(0)
  const clearRequest = useRef(0)
  const feedbackRequest = useRef(0)
  const clearActive = useRef(false)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [])
  return useMemo(
    () => ({ lifecycle, generation, loadRequest, clearRequest, feedbackRequest, clearActive }),
    [],
  )
}

type HistoryRuntime = ReturnType<typeof useHistoryRuntime>

function mapHistoryEntries(items: Awaited<ReturnType<typeof CommandHistoryService.List>>) {
  return (items ?? []).map((item: { id: number; command: string; created_at?: string; createdAt?: string }) => ({
    id: String(item.id),
    command: item.command,
    createdAt: Date.parse(item.created_at ?? item.createdAt ?? '') || Date.now(),
  }))
}

function useHistoryEntries(sessionID: number, runtime: HistoryRuntime, source: symbol) {
  const [entries, setEntries] = useState<CommandHistoryEntry[]>(() => readCommandHistory(sessionID))
  const [loadError, setLoadError] = useState('')
  const loadHistory = useCallback(async () => {
    const lifecycleToken = runtime.lifecycle.current
    const generationToken = runtime.generation.current
    const request = ++runtime.loadRequest.current
    const isCurrent = () => runtime.lifecycle.current === lifecycleToken
      && runtime.generation.current === generationToken && runtime.loadRequest.current === request
    if (sessionID <= 0) {
      if (isCurrent()) { setEntries(readCommandHistory(sessionID)); setLoadError('') }
      return
    }
    try {
      const items = await CommandHistoryService.List(sessionID, '')
      if (isCurrent()) { setEntries(mapHistoryEntries(items)); setLoadError('') }
    } catch (error: unknown) {
      if (!isCurrent()) return
      logger.error('command history loading failed', error)
      setLoadError(error instanceof Error ? error.message : String(error))
    }
  }, [runtime, sessionID])
  useEffect(() => {
    runtime.generation.current++
    runtime.loadRequest.current++
    runtime.feedbackRequest.current++
    setEntries(sessionID <= 0 ? readCommandHistory(sessionID) : [])
    setLoadError('')
    if (sessionID <= 0 || typeof CommandHistoryService?.List === 'function') void loadHistory()
  }, [loadHistory, runtime, sessionID])
  useEffect(() => onCommandHistoryChanged(sessionID, source, () => {
    void loadHistory()
  }), [loadHistory, sessionID, source])
  return { entries, setEntries, loadError }
}

type HistoryEntries = ReturnType<typeof useHistoryEntries>

function useVirtualHistory(entries: CommandHistoryEntry[]) {
  const [query, setQuery] = useState('')
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(360)
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
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop)
    setViewportHeight(event.currentTarget.clientHeight)
  }
  return { query, setQuery, filtered, windowed, onScroll }
}

type VirtualHistory = ReturnType<typeof useVirtualHistory>

function useHistoryFeedback(runtime: HistoryRuntime, sessionID: number) {
  const [actionError, setActionError] = useState('')
  useEffect(() => { setActionError('') }, [sessionID])
  const copy = async (command: string) => {
    const lifecycleToken = runtime.lifecycle.current
    const generationToken = runtime.generation.current
    const request = ++runtime.feedbackRequest.current
    const isCurrent = () => runtime.lifecycle.current === lifecycleToken
      && runtime.generation.current === generationToken && runtime.feedbackRequest.current === request
    try {
      await getClipboard().writeText(command)
      if (isCurrent()) {
        setActionError('')
        toast(t('命令已复制'), 'success')
      }
    } catch (error: unknown) {
      if (isCurrent()) setActionError(t('复制失败: ${}', error instanceof Error ? error.message : String(error)))
    }
  }
  return { actionError, setActionError, copy }
}

type HistoryFeedback = ReturnType<typeof useHistoryFeedback>

async function confirmHistoryClear() {
  return requestConfirm({
    title: t('清空命令历史'),
    description: t('确认清空当前会话的命令历史？此操作不可撤销。'),
    confirmLabel: t('清空'),
    cancelLabel: t('取消'),
    destructive: true,
  })
}

interface ClearHistoryOptions {
  sessionID: number
  runtime: HistoryRuntime
  history: HistoryEntries
  feedback: HistoryFeedback
  source: symbol
  setClearing: (value: boolean) => void
}

async function runHistoryClear({ sessionID, runtime, history, feedback, source, setClearing }: ClearHistoryOptions) {
  if (history.entries.length === 0 || runtime.clearActive.current) return
  runtime.clearActive.current = true
  const lifecycleToken = runtime.lifecycle.current
  const generationToken = runtime.generation.current
  const request = ++runtime.clearRequest.current
  const isLatest = () => runtime.lifecycle.current === lifecycleToken && runtime.clearRequest.current === request
  const isCurrent = () => isLatest() && runtime.generation.current === generationToken
  setClearing(true); feedback.setActionError('')
  try {
    await runCommandHistoryMutation(sessionID, async () => {
      const ok = await confirmHistoryClear()
      if (!ok || !isCurrent()) return
      const feedbackRequest = ++runtime.feedbackRequest.current
      runtime.loadRequest.current++
      await clearCommandHistory(sessionID, source)
      if (!isCurrent()) return
      history.setEntries([])
      if (runtime.feedbackRequest.current === feedbackRequest) toast(t('命令历史已清空'), 'success')
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    if (!isOperationBusyError(error)) logger.error('command history clear failed', error)
    if (isCurrent()) feedback.setActionError(t('清空命令历史失败: ${}', message))
  } finally {
    if (runtime.clearRequest.current === request) runtime.clearActive.current = false
    if (isLatest()) setClearing(false)
  }
}

function useClearHistory(options: Omit<ClearHistoryOptions, 'setClearing'>) {
  const [clearing, setClearing] = useState(false)
  const sharedClearing = useCommandHistoryMutationState((state) => state.busySessionIDs.has(options.sessionID))
  useEffect(() => { setClearing(options.runtime.clearActive.current) }, [options.runtime, options.sessionID])
  const clear = () => runHistoryClear({ ...options, setClearing })
  return { clear, clearing, blocked: clearing || sharedClearing }
}

function HistoryPanelHeader({ disabled, onClose }: { disabled: boolean; onClose: () => void }) {
  return <div className="flex items-center justify-between border-b border-border px-3 py-2">
    <span className="flex items-center gap-2 text-sm font-medium"><History className="size-4" />{t('命令历史')}</span>
    <Button size="icon-xs" variant="ghost" disabled={disabled} aria-label={t('关闭历史')} onClick={onClose}><X /></Button>
  </div>
}

function HistoryPanelToolbar({ virtual, clear, entryCount }: {
  virtual: VirtualHistory
  clear: ReturnType<typeof useClearHistory>
  entryCount: number
}) {
  return <div className="flex gap-2 border-b border-border p-2">
    <Input placeholder={t('搜索历史命令...')} value={virtual.query} onChange={(event) => virtual.setQuery(event.target.value)} />
    <Button size="xs" variant="ghost" onClick={() => { void clear.clear() }} disabled={entryCount === 0 || clear.blocked}
      title={t('清空历史')} aria-label={t('清空历史')}><Trash2 /></Button>
  </div>
}

function HistoryRow({ entry, item, onCopy, onFill }: {
  entry: CommandHistoryEntry
  item: VirtualHistory['windowed']['items'][number]
  onCopy: (command: string) => Promise<void>
  onFill: (command: string) => void
}) {
  return <div className="group absolute left-0 right-0 rounded-md p-2 hover:bg-muted/60 focus-within:bg-muted/60"
    style={{ top: item.start, height: item.size - 4 }}>
    <code className="block whitespace-pre-wrap break-all text-xs">{entry.command}</code>
    <div className="mt-1 flex justify-end gap-1 opacity-100 focus-within:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
      <Button size="xs" variant="ghost" onClick={() => { void onCopy(entry.command) }}><Clipboard />{t('复制')}</Button>
      <Button size="xs" variant="ghost" onClick={() => onFill(entry.command)}>{t('填入终端')}</Button>
    </div>
  </div>
}

function HistoryPanelList({ virtual, loadError, onCopy, onFill }: {
  virtual: VirtualHistory
  loadError: string
  onCopy: (command: string) => Promise<void>
  onFill: (command: string) => void
}) {
  let content = <p className="p-3 text-xs text-muted-foreground">{t('暂无命令历史')}</p>
  if (loadError) content = <p className="p-3 text-xs text-destructive" role="alert">{t('加载命令历史失败: ${}', loadError)}</p>
  else if (virtual.filtered.length > 0) content = <div style={{ height: virtual.windowed.totalSize, position: 'relative' }}>
    {virtual.windowed.items.map((item) => {
      const entry = virtual.filtered[item.index]
      return <HistoryRow key={entry.id} entry={entry} item={item} onCopy={onCopy} onFill={onFill} />
    })}
  </div>
  return <div className="min-h-0 flex-1 overflow-y-auto p-2" onScroll={virtual.onScroll}>{content}</div>
}
