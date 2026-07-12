import { ArrowDownToLine, ArrowUpFromLine, RotateCcw, Trash2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import type { TransferJob } from '@/store/appStore'
import { isActiveTransfer } from '@/lib/transferMetrics'

interface TransferItemProps {
  transfer: TransferJob
  onCancel: (transfer: TransferJob) => void
  onRetry: (transfer: TransferJob) => void
  onRemove: (transfer: TransferJob) => void
}

const statusLabels: Record<TransferJob['status'], string> = {
  queued: '排队中',
  running: '传输中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

function statusVariant(status: TransferJob['status']): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'failed') return 'destructive'
  if (status === 'completed') return 'secondary'
  if (status === 'running') return 'default'
  return 'outline'
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '大小未知'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

function formatSpeed(bytesPerSecond: number): string {
  return bytesPerSecond > 0 ? `${formatBytes(bytesPerSecond)}/s` : '等待速度数据'
}

function formatETA(seconds: number): string {
  if (seconds <= 0) return '计算剩余时间'
  if (seconds < 60) return `剩余 ${seconds} 秒`
  return `剩余 ${Math.ceil(seconds / 60)} 分钟`
}

function progressValue(transfer: TransferJob): number | null {
  if (transfer.totalBytes <= 0) return null
  return Math.min(100, Math.round((transfer.transferredBytes / transfer.totalBytes) * 100))
}

export function TransferItem({ transfer, onCancel, onRetry, onRemove }: TransferItemProps) {
  const active = isActiveTransfer(transfer)
  const percentage = progressValue(transfer)
  const DirectionIcon = transfer.direction === 'upload' ? ArrowUpFromLine : ArrowDownToLine

  return <Card className="gap-3 py-3">
    <CardHeader className="flex flex-row items-start gap-3 px-3">
      <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-foreground"><DirectionIcon className="size-4" /></div>
      <div className="min-w-0 flex-1">
        <CardTitle className="truncate text-sm">{transfer.fileName}</CardTitle>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">{transfer.sessionName}</Badge>
          <Badge variant={statusVariant(transfer.status)}>{statusLabels[transfer.status]}</Badge>
        </div>
      </div>
      {active && <Button size="icon-xs" variant="ghost" aria-label={`取消 ${transfer.fileName}`} onClick={() => onCancel(transfer)}><X /></Button>}
      {transfer.status === 'failed' && <Button size="icon-xs" variant="outline" aria-label={`重试 ${transfer.fileName}`} onClick={() => onRetry(transfer)}><RotateCcw /></Button>}
      {!active && <Button size="icon-xs" variant="ghost" aria-label={`移除 ${transfer.fileName}`} onClick={() => onRemove(transfer)}><Trash2 /></Button>}
    </CardHeader>
    <CardContent className="flex flex-col gap-2 px-3">
      {active && <>
        <div className="flex items-center justify-between gap-3 text-xs"><span className="text-muted-foreground">{formatBytes(transfer.transferredBytes)} / {formatBytes(transfer.totalBytes)}</span><span className="tabular-nums text-foreground">{percentage === null ? '准备中' : `${percentage}%`}</span></div>
        <Progress value={percentage} aria-label={`${transfer.fileName} 传输进度`} />
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>{formatSpeed(transfer.speed)}</span><span>{formatETA(transfer.eta)}</span></div>
      </>}
      {!active && <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>{formatBytes(transfer.totalBytes || transfer.transferredBytes)}</span><span>{transfer.completedAt ? new Date(transfer.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span></div>}
      {transfer.error && <p className="rounded-lg bg-destructive/10 px-2.5 py-2 text-xs text-destructive">{transfer.error}</p>}
    </CardContent>
  </Card>
}
