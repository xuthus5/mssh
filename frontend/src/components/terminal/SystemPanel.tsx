import { useEffect, useMemo, useState } from 'react'
import { Server, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { logger } from '@/lib/logger'
import { useToolPanelResize } from '@/hooks/useToolPanelResize'
import { AsyncPoller } from '@/lib/asyncPoller'
import { TerminalService } from '@/lib/wails'
import { t } from '@/i18n'
import { isTerminalGone } from '@/lib/terminalGone'
import { ContainerPanel } from '@/components/terminal/container/ContainerPanel'
import { ListeningPanel } from '@/components/terminal/listener/ListeningPanel'
import { Overview, formatBytes, type Info } from '@/components/terminal/SystemOverview'

type Process = {
  pid: number; ppid: number; user: string; state: string
  cpu_percent: number; memory_bytes: number; command: string; cpu_source?: string
}

type TerminalSnapshot<T> = { terminalID: string; value: T }

function Rank({ title, rows, cpu = false }: { title: string; rows: Process[]; cpu?: boolean }) {
  return <div className="rounded-xl border border-border p-3 shadow-sm">
    <div className="mb-2 text-xs font-medium">{title}</div>
    {rows.map((process) => <div key={process.pid} className="flex justify-between gap-2 text-xs text-muted-foreground">
      <span className="truncate" title={process.command}>{process.command}</span>
      <span className="shrink-0 tabular-nums">{cpu ? `${process.cpu_percent.toFixed(1)}%` : formatBytes(process.memory_bytes)}</span>
    </div>)}
  </div>
}

function ProcessTable({ processes }: { processes: Process[] }) {
  return <div data-testid="process-table" className="overflow-hidden rounded-xl border border-border shadow-sm">
    <div className="grid grid-cols-[55px_70px_1fr_55px_70px] gap-2 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <span>PID</span><span>{t('用户')}</span><span>{t('命令')}</span><span>{t('CPU')}</span><span>{t('内存')}</span>
    </div>
    {processes.map((process) => <div key={process.pid} className="grid grid-cols-[55px_70px_1fr_55px_70px] gap-2 border-t border-border px-3 py-2 text-xs">
      <span>{process.pid}</span><span className="truncate">{process.user}</span>
      <span className="truncate" title={process.command}>{process.command}</span>
      <span className="tabular-nums">{process.cpu_percent.toFixed(1)}%</span><span className="tabular-nums">{formatBytes(process.memory_bytes)}</span>
    </div>)}
  </div>
}

function ProcessesView({ processes, query, onQueryChange }: { processes: Process[]; query: string; onQueryChange: (value: string) => void }) {
  const filtered = useMemo(() => processes.filter((process) => `${process.pid} ${process.user} ${process.command}`.toLowerCase().includes(query.toLowerCase())), [processes, query])
  const cpuTop = useMemo(() => processes.slice().sort((left, right) => right.cpu_percent - left.cpu_percent).slice(0, 5), [processes])
  const memoryTop = useMemo(() => processes.slice().sort((left, right) => right.memory_bytes - left.memory_bytes).slice(0, 5), [processes])
  const fallbackCPU = processes.some((process) => process.cpu_source === 'ps_average')
  return <div className="space-y-3">
    <Input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={t('搜索 PID、用户或命令')} />
    <p className="text-[11px] text-muted-foreground">{t('CPU 为采样间隔内的瞬时占用，首次采样可能为 0。')}</p>
    {fallbackCPU ? <p data-testid="process-cpu-fallback" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300">{t('当前系统仅能提供 ps 生命周期平均 CPU，非采样间隔瞬时值。')}</p> : null}
    <div className="grid grid-cols-2 gap-3"><Rank title="CPU Top 5" rows={cpuTop} cpu /><Rank title={t('内存 Top 5')} rows={memoryTop} /></div>
    <ProcessTable processes={filtered} />
  </div>
}

function useSystemInfo(terminalID: string) {
  const [snapshot, setSnapshot] = useState<TerminalSnapshot<Info> | null>(null)
  const [failedTerminalID, setFailedTerminalID] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    let requestID = 0
    let poller: AsyncPoller | null = null
    const load = async () => {
      const currentRequest = ++requestID
      try {
        const value = await TerminalService.SystemInfo(terminalID)
        if (!value) {
          logger.error('system panel info collection returned empty response')
          if (!cancelled && currentRequest === requestID) setFailedTerminalID(terminalID)
          return
        }
        if (!cancelled && currentRequest === requestID) {
          setSnapshot({ terminalID, value })
          setFailedTerminalID(null)
        }
      } catch (error: unknown) {
        if (isTerminalGone(error)) {
          if (!cancelled && currentRequest === requestID) setFailedTerminalID(terminalID)
          poller?.stop()
          return
        }
        logger.error('system panel info collection failed', error)
        if (!cancelled && currentRequest === requestID) setFailedTerminalID(terminalID)
      }
    }
    setFailedTerminalID((current) => current === terminalID ? null : current)
    poller = new AsyncPoller({ task: load, delayMs: 3000, onError: (error) => logger.error('system info polling failed', error) })
    void poller.start()
    return () => { cancelled = true; requestID += 1; poller?.stop() }
  }, [terminalID, attempt])
  const retry = () => {
    setSnapshot(null)
    setFailedTerminalID(null)
    setAttempt((value) => value + 1)
  }
  return {
    info: snapshot?.terminalID === terminalID ? snapshot.value : null,
    failed: failedTerminalID === terminalID,
    retry,
  }
}

function useProcesses(terminalID: string, active: boolean) {
  const [snapshot, setSnapshot] = useState<TerminalSnapshot<Process[]> | null>(null)
  const [failedTerminalID, setFailedTerminalID] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!active) return
    let cancelled = false
    let requestID = 0
    let poller: AsyncPoller | null = null
    const load = async () => {
      const currentRequest = ++requestID
      try {
        const value = await TerminalService.ProcessInfo(terminalID)
        if (!cancelled && currentRequest === requestID) {
          setSnapshot({ terminalID, value })
          setFailedTerminalID(null)
        }
      } catch (error: unknown) {
        if (isTerminalGone(error)) {
          if (!cancelled && currentRequest === requestID) setFailedTerminalID(terminalID)
          poller?.stop()
          return
        }
        logger.error('system panel process collection failed', error)
        if (!cancelled && currentRequest === requestID) setFailedTerminalID(terminalID)
      }
    }
    setFailedTerminalID((current) => current === terminalID ? null : current)
    poller = new AsyncPoller({ task: load, delayMs: 5000, onError: (error) => logger.error('process info polling failed', error) })
    void poller.start()
    return () => { cancelled = true; requestID += 1; poller?.stop() }
  }, [active, terminalID, attempt])
  const retry = () => {
    setSnapshot(null)
    setFailedTerminalID(null)
    setAttempt((value) => value + 1)
  }
  return {
    processes: snapshot?.terminalID === terminalID ? snapshot.value : [],
    failed: failedTerminalID === terminalID,
    retry,
  }
}

function CollectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
      <span>{message}</span>
      <Button type="button" size="xs" variant="outline" onClick={onRetry}>{t('重试')}</Button>
    </div>
  )
}

export function SystemPanel({ terminalID, onClose }: { terminalID: string; onClose: () => void }) {
  const panel = useToolPanelResize('system')
  const [tab, setTab] = useState('overview')
  const [query, setQuery] = useState('')
  const system = useSystemInfo(terminalID)
  const processState = useProcesses(terminalID, tab === 'processes')
  return <aside style={panel.panelStyle} className="absolute inset-y-0 right-0 z-20 flex flex-col border-l border-border bg-card shadow-xl" data-testid="system-panel">
    <div {...panel.resizeHandleProps} className="absolute inset-y-0 -left-1 z-30 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent hover:after:bg-primary/60 focus-visible:after:bg-primary active:after:bg-primary" />
    <header className="flex items-center justify-between border-b border-border px-4 py-3">
      <span className="flex items-center gap-2 text-sm font-semibold"><Server className="size-4" />{t('系统监控')}</span>
      <Button size="icon-xs" variant="ghost" aria-label={t('关闭系统监控')} onClick={onClose}><X /></Button>
    </header>
    <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
      <TabsList className="mx-4 mt-3"><TabsTrigger value="overview">{t('概览')}</TabsTrigger><TabsTrigger value="processes">{t('进程')}</TabsTrigger><TabsTrigger value="listeners">{t('监听')}</TabsTrigger><TabsTrigger value="containers">{t('容器')}</TabsTrigger></TabsList>
      <TabsContent value="overview" className="min-h-0 flex-1 overflow-y-auto p-4">
        {system.failed ? <CollectionError message={t('系统信息采集失败')} onRetry={system.retry} /> : system.info ? <Overview info={system.info} /> : <p className="text-sm text-muted-foreground">{t('正在采集系统信息...')}</p>}
      </TabsContent>
      <TabsContent value="processes" className="min-h-0 flex-1 overflow-y-auto p-4">
        {processState.failed ? <CollectionError message={t('进程信息采集失败')} onRetry={processState.retry} /> : <ProcessesView processes={processState.processes} query={query} onQueryChange={setQuery} />}
      </TabsContent>
      <TabsContent value="listeners" className="min-h-0 flex-1 overflow-y-auto p-4">
        <ListeningPanel terminalID={terminalID} active={tab === 'listeners'} />
      </TabsContent>
      <TabsContent value="containers" className="min-h-0 flex-1 overflow-y-auto p-4">
        <ContainerPanel terminalID={terminalID} active={tab === 'containers'} />
      </TabsContent>
    </Tabs>
  </aside>
}
