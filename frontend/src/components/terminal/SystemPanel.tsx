import { useEffect, useMemo, useState } from 'react'
import { Cpu, HardDrive, MemoryStick, Network, Server, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { logger } from '@/lib/logger'
import { useToolPanelResize } from '@/hooks/useToolPanelResize'
import { TerminalService } from '@/lib/wails'
import { t } from '@/i18n'
import { isTerminalGone } from '@/lib/terminalGone'


type Info = {
  cpu_percent: number; cpu_count: number; memory_used: number; memory_total: number
  disk_used: number; disk_total: number; download_rate: number; upload_rate: number
  swap_used: number; swap_total: number; load_1: number; load_5: number; load_15: number
  uptime_seconds: number; os_name: string; kernel_version: string
}

type Process = {
  pid: number; ppid: number; user: string; state: string
  cpu_percent: number; memory_bytes: number; command: string
}

const BYTE_UNITS = ['B', 'K', 'M', 'G', 'T'] as const

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0B'
  let amount = value
  let unit = 0
  while (amount >= 1024 && unit < BYTE_UNITS.length - 1) {
    amount /= 1024
    unit += 1
  }
  const precision = unit === 0 || amount >= 100 ? 0 : 1
  return `${amount.toFixed(precision).replace(/\.0$/, '')}${BYTE_UNITS[unit]}`
}

function formatDuration(seconds: number) {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor(seconds % 86400 / 3600)
  const minutes = Math.floor(seconds % 3600 / 60)
  return `${days}d ${hours}h ${minutes}m`
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="rounded-xl border border-border bg-background/50 p-3 shadow-sm">
    <div className="flex items-center gap-2 text-xs text-muted-foreground [&_svg]:size-3.5">{icon}{label}</div>
    <div className="mt-2 text-sm font-semibold tabular-nums">{value}</div>
  </div>
}

function DetailItem({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return <div className={`flex min-w-0 items-start gap-2 ${wide ? 'col-span-2' : ''}`}>
    <span className="shrink-0 text-muted-foreground">{label}</span>
    <span className="min-w-0 break-words text-foreground" title={value}>{value}</span>
  </div>
}

function Overview({ info }: { info: Info }) {
  const network = `↓${formatBytes(info.download_rate)}/s ↑${formatBytes(info.upload_rate)}/s`
  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-2">
      <Metric icon={<Cpu />} label="CPU" value={`${info.cpu_percent.toFixed(0)}% (${info.cpu_count}c)`} />
      <Metric icon={<MemoryStick />} label={t('内存')} value={`${formatBytes(info.memory_used)}/${formatBytes(info.memory_total)}`} />
      <Metric icon={<HardDrive />} label={t('磁盘')} value={`${formatBytes(info.disk_used)}/${formatBytes(info.disk_total)}`} />
      <Metric icon={<Network />} label={t('网络')} value={network} />
    </div>
    <section className="rounded-xl border border-border bg-background/30 p-3 text-xs shadow-sm">
      <div className="mb-3 font-medium">{t('系统详情')}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        <DetailItem label={t('负载')} value={`${info.load_1.toFixed(2)} / ${info.load_5.toFixed(2)} / ${info.load_15.toFixed(2)}`} />
        <DetailItem label={t('运行')} value={formatDuration(info.uptime_seconds)} />
        <DetailItem label={t('系统')} value={info.os_name || 'Linux'} wide />
        <DetailItem label={t('内核')} value={info.kernel_version || t('未知')} wide />
        <DetailItem label="Swap" value={`${formatBytes(info.swap_used)}/${formatBytes(info.swap_total)}`} wide />
      </div>
    </section>
  </div>
}

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
  return <div className="overflow-hidden rounded-xl border border-border shadow-sm">
    <div className="grid grid-cols-[55px_70px_1fr_65px] gap-2 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <span>PID</span><span>{t('用户')}</span><span>{t('命令')}</span><span>{t('资源')}</span>
    </div>
    {processes.map((process) => <div key={process.pid} className="grid grid-cols-[55px_70px_1fr_65px] gap-2 border-t border-border px-3 py-2 text-xs">
      <span>{process.pid}</span><span className="truncate">{process.user}</span>
      <span className="truncate" title={process.command}>{process.command}</span>
      <span className="tabular-nums">{process.cpu_percent.toFixed(1)}%</span>
    </div>)}
  </div>
}

function ProcessesView({ processes, query, onQueryChange }: { processes: Process[]; query: string; onQueryChange: (value: string) => void }) {
  const filtered = useMemo(() => processes.filter((process) => `${process.pid} ${process.user} ${process.command}`.toLowerCase().includes(query.toLowerCase())), [processes, query])
  const cpuTop = useMemo(() => processes.slice().sort((left, right) => right.cpu_percent - left.cpu_percent).slice(0, 5), [processes])
  const memoryTop = useMemo(() => processes.slice().sort((left, right) => right.memory_bytes - left.memory_bytes).slice(0, 5), [processes])
  return <div className="space-y-3">
    <Input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={t('搜索 PID、用户或命令')} />
    <div className="grid grid-cols-2 gap-3"><Rank title="CPU Top 5" rows={cpuTop} cpu /><Rank title={t('内存 Top 5')} rows={memoryTop} /></div>
    <ProcessTable processes={filtered} />
  </div>
}

function useSystemInfo(terminalID: string) {
  const [info, setInfo] = useState<Info | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    let timer: number | null = null
    const stop = () => {
      if (timer !== null) {
        window.clearInterval(timer)
        timer = null
      }
    }
    const load = async () => {
      try {
        const value = await TerminalService.SystemInfo(terminalID)
        if (!cancelled) { setInfo(value); setFailed(false) }
      } catch (error: unknown) {
        if (isTerminalGone(error)) {
          if (!cancelled) setFailed(true)
          stop()
          return
        }
        logger.error('system panel info collection failed', error)
        if (!cancelled) setFailed(true)
      }
    }
    void load()
    timer = window.setInterval(() => { void load() }, 3000)
    return () => { cancelled = true; stop() }
  }, [terminalID])
  return { info, failed }
}

function useProcesses(terminalID: string, active: boolean) {
  const [processes, setProcesses] = useState<Process[]>([])
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!active) return
    let cancelled = false
    let timer: number | null = null
    const stop = () => {
      if (timer !== null) {
        window.clearInterval(timer)
        timer = null
      }
    }
    const load = async () => {
      try {
        const value = await TerminalService.ProcessInfo(terminalID)
        if (!cancelled) { setProcesses(value); setFailed(false) }
      } catch (error: unknown) {
        if (isTerminalGone(error)) {
          if (!cancelled) setFailed(true)
          stop()
          return
        }
        logger.error('system panel process collection failed', error)
        if (!cancelled) setFailed(true)
      }
    }
    void load()
    timer = window.setInterval(() => { void load() }, 5000)
    return () => { cancelled = true; stop() }
  }, [active, terminalID])
  return { processes, failed }
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
      <TabsList className="mx-4 mt-3"><TabsTrigger value="overview">{t('概览')}</TabsTrigger><TabsTrigger value="processes">{t('进程')}</TabsTrigger></TabsList>
      <TabsContent value="overview" className="min-h-0 flex-1 overflow-y-auto p-4">
        {system.failed ? <p className="text-sm text-destructive">{t('系统信息采集失败')}</p> : system.info ? <Overview info={system.info} /> : <p className="text-sm text-muted-foreground">{t('正在采集系统信息...')}</p>}
      </TabsContent>
      <TabsContent value="processes" className="min-h-0 flex-1 overflow-y-auto p-4">
        {processState.failed ? <p className="text-sm text-destructive">{t('进程信息采集失败')}</p> : <ProcessesView processes={processState.processes} query={query} onQueryChange={setQuery} />}
      </TabsContent>
    </Tabs>
  </aside>
}
