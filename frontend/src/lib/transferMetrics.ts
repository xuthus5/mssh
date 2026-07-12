import type { TransferJob } from '@/store/appStore'

export function isActiveTransfer(transfer: TransferJob): boolean {
  return transfer.status === 'queued' || transfer.status === 'running'
}

export function partitionTransfers(transfers: readonly TransferJob[]) {
  const active = transfers.filter(isActiveTransfer).sort((left, right) => right.startedAt - left.startedAt)
  const recent = transfers.filter((transfer) => !isActiveTransfer(transfer)).sort((left, right) => (right.completedAt ?? right.startedAt) - (left.completedAt ?? left.startedAt))
  return { active, recent }
}

export function aggregateTransferProgress(transfers: readonly TransferJob[]) {
  const active = transfers.filter(isActiveTransfer)
  const hasUnknownSize = active.some((transfer) => transfer.totalBytes <= 0)
  if (active.length === 0 || hasUnknownSize) {
    return { activeCount: active.length, percentage: null, hasUnknownSize }
  }
  const totalBytes = active.reduce((total, transfer) => total + transfer.totalBytes, 0)
  const transferredBytes = active.reduce((total, transfer) => total + Math.min(transfer.transferredBytes, transfer.totalBytes), 0)
  return { activeCount: active.length, percentage: Math.round((transferredBytes / totalBytes) * 100), hasUnknownSize: false }
}
