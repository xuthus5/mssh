import { Progress } from '@/components/ui/progress'
import { useEffect } from 'react'
import type { TransferJob } from '@/hooks/useFileTransfer'

interface Props {
  transfers: TransferJob[]
  onCancel: (jobId: string) => void
}

export default function TransferProgress({ transfers }: Props) {
  useEffect(() => {
    // Wails binding stub: subscribe to progress updates
    console.debug('[TransferProgress] active transfers:', transfers.length)
  }, [transfers])

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
          </div>
        )
      })}
    </div>
  )
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec === 0) return '0 B/s'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  const i = Math.floor(Math.log(bytesPerSec) / Math.log(1024))
  if (i >= units.length) return `${bytesPerSec} B/s`
  return `${(bytesPerSec / 1024 ** i).toFixed(1)} ${units[i]}`
}
