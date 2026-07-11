import { Progress } from '@/components/ui/progress'
import { useEffect } from 'react'
import type { TransferJob } from '@/hooks/useFileTransfer'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'

interface Props {
  transfers: TransferJob[]
  onCancel: (jobId: string) => void
}

export default function TransferProgress({ transfers, onCancel }: Props) {

  if (transfers.length === 0) return null

  return (
    <div className="flex items-center gap-2">
      {transfers.map((t) => {
        const pct =
          t.totalBytes > 0
            ? Math.round((t.transferredBytes / t.totalBytes) * 100)
            : 0
        return (
          <div key={t.id} className="flex items-center gap-2">
            <span className="text-xs">
              {t.direction === 'upload' ? '△' : '▽'} {t.fileName}
            </span>
            <Progress value={pct} className="w-24">
              <span className="text-xs tabular-nums">{pct}%</span>
            </Progress>
            <span className="text-xs">{formatSpeed(t.speed)}</span>
            {t.eta > 0 && t.status === 'running' && <span className="text-xs">剩余 {formatETA(t.eta)}</span>}
            {t.status !== 'running' && t.status !== 'queued' && (
              <span className="text-xs text-muted-foreground">
                {t.status === 'completed' ? '已完成' : t.status === 'cancelled' ? '已取消' : '失败'}
              </span>
            )}
            {(t.status === 'running' || t.status === 'queued') && (
              <Button size="icon-xs" variant="ghost" aria-label={`取消 ${t.fileName}`} onClick={() => onCancel(t.id)}>
                <X />
              </Button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function formatETA(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.ceil(seconds / 60)
  return `${minutes} 分钟`
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec === 0) return '0 B/s'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  const i = Math.floor(Math.log(bytesPerSec) / Math.log(1024))
  if (i >= units.length) return `${bytesPerSec} B/s`
  return `${(bytesPerSec / 1024 ** i).toFixed(1)} ${units[i]}`
}
