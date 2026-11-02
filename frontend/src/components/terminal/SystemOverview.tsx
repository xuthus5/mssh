import { AlertTriangle, ArrowDown, ArrowUp, Cpu, HardDrive, MemoryStick, Network } from 'lucide-react'
import { t } from '@/i18n'

export type NetworkMetric = {
  name: string; received_bytes: number; transmitted_bytes: number
  download_rate: number; upload_rate: number; virtual?: boolean
}

export type DiskMetric = {
  device: string; mount_point: string; used_bytes: number; total_bytes: number; available_bytes: number
}

export type Info = {
  schema_version?: number; sampled_at_unix_ms?: number; source?: string; warnings?: string[]
  cpu_percent: number; cpu_count: number; memory_used: number; memory_total: number
  disk_used: number; disk_total: number; download_rate: number; upload_rate: number
  swap_used: number; swap_total: number; load_1: number; load_5: number; load_15: number
  uptime_seconds: number; os_name: string; kernel_version: string; latency_ms?: number
  interfaces?: NetworkMetric[]; disk_mounts?: DiskMetric[]
}

const BYTE_UNITS = ['B', 'K', 'M', 'G', 'T'] as const
const WARNING_LABELS: Record<string, string> = {
  cpu_unavailable: 'CPU 指标不可用',
  cpu_count_unavailable: 'CPU 核心数不可用',
  memory_unavailable: '内存指标不可用',
  swap_unavailable: 'Swap 指标不可用',
  network_unavailable: '网络指标不可用',
  disk_unavailable: '磁盘指标不可用',
  load_unavailable: '负载指标不可用',
  uptime_unavailable: '运行时长不可用',
}

export function formatBytes(value: number) {
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

function CollectionWarnings({ warnings }: { warnings?: string[] }) {
  if (!warnings?.length) return null
  return <div data-testid="system-warnings" role="status" className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
    <div className="space-y-1">
      <div className="font-medium">{t('部分指标不可用')}</div>
      <div>{warnings.map((warning) => t(WARNING_LABELS[warning] ?? warning)).join('、')}</div>
    </div>
  </div>
}

function NetworkDetails({ interfaces }: { interfaces?: NetworkMetric[] }) {
  if (!interfaces?.length) return null
  return <section data-testid="network-interfaces" className="rounded-xl border border-border bg-background/30 p-3 text-xs shadow-sm">
    <div className="mb-2 font-medium">{t('网络接口')}</div>
    <div className="space-y-2">
      {interfaces.map((item) => <div key={item.name} className="grid grid-cols-[1fr_auto] items-center gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-foreground" title={`${formatBytes(item.received_bytes)} / ${formatBytes(item.transmitted_bytes)}`}>{item.name}</span>
          {item.virtual ? <span className="rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">{t('虚拟')}</span> : null}
        </span>
        <span className="flex items-center gap-2 tabular-nums text-muted-foreground">
          <span className="flex items-center gap-0.5"><ArrowDown className="size-3" />{formatBytes(item.download_rate)}/s</span>
          <span className="flex items-center gap-0.5"><ArrowUp className="size-3" />{formatBytes(item.upload_rate)}/s</span>
        </span>
      </div>)}
    </div>
  </section>
}

function DiskDetails({ mounts }: { mounts?: DiskMetric[] }) {
  if (!mounts?.length) return null
  return <section data-testid="disk-mounts" className="rounded-xl border border-border bg-background/30 p-3 text-xs shadow-sm">
    <div className="mb-2 font-medium">{t('挂载点')}</div>
    <div className="space-y-2">
      {mounts.map((mount) => <div key={`${mount.device}:${mount.mount_point}`} className="grid grid-cols-[1fr_auto] items-center gap-3">
        <span className="min-w-0"><span className="block truncate font-mono text-foreground" title={mount.mount_point}>{mount.mount_point}</span><span className="block truncate text-[10px] text-muted-foreground" title={mount.device}>{mount.device}</span></span>
        <span className="tabular-nums text-muted-foreground">{formatBytes(mount.used_bytes)}/{formatBytes(mount.total_bytes)}</span>
      </div>)}
    </div>
  </section>
}

export function Overview({ info }: { info: Info }) {
  const network = `↓${formatBytes(info.download_rate)}/s ↑${formatBytes(info.upload_rate)}/s`
  const source = info.source || t('未知')
  const latency = typeof info.latency_ms === 'number' ? `${info.latency_ms.toFixed(0)}ms` : t('未知')
  return <div className="space-y-4">
    <CollectionWarnings warnings={info.warnings} />
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
        <DetailItem label={t('数据源')} value={`${source} · v${info.schema_version ?? 0}`} wide />
        <DetailItem label={t('采集耗时')} value={latency} wide />
      </div>
    </section>
    <NetworkDetails interfaces={info.interfaces} />
    <DiskDetails mounts={info.disk_mounts} />
  </div>
}
