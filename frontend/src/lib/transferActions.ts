import { FileService } from '@/lib/wails'
import { useAppStore, type TransferJob } from '@/store/appStore'

interface TransferRequest {
  sessionId: number
  sessionName: string
  sourcePath: string
  targetPath: string
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function queuedTransfer(id: string, direction: TransferJob['direction'], request: TransferRequest): TransferJob {
  return {
    id,
    fileName: fileName(request.sourcePath),
    direction,
    sessionId: request.sessionId,
    sessionName: request.sessionName,
    sourcePath: request.sourcePath,
    targetPath: request.targetPath,
    totalBytes: 0,
    transferredBytes: 0,
    speed: 0,
    eta: 0,
    status: 'queued',
    startedAt: Date.now(),
  }
}

async function startTransfer(direction: TransferJob['direction'], request: TransferRequest): Promise<TransferJob> {
  const id = direction === 'upload'
    ? await FileService.Upload(request.sessionId, request.sourcePath, request.targetPath)
    : await FileService.Download(request.sessionId, request.sourcePath, request.targetPath)
  const transfer = queuedTransfer(id, direction, request)
  useAppStore.getState().addTransfer(transfer)
  return transfer
}

export function startUpload(request: TransferRequest): Promise<TransferJob> {
  return startTransfer('upload', request)
}

export function startDownload(request: TransferRequest): Promise<TransferJob> {
  return startTransfer('download', request)
}

export function cancelTransfer(jobId: string): Promise<void> {
  return FileService.CancelTransfer(jobId)
}

export async function retryTransfer(transfer: TransferJob): Promise<TransferJob> {
  const request = { sessionId: transfer.sessionId, sessionName: transfer.sessionName, sourcePath: transfer.sourcePath, targetPath: transfer.targetPath }
  const replacement = await startTransfer(transfer.direction, request)
  useAppStore.getState().removeTransfer(transfer.id)
  return replacement
}
