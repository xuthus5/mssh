import { useCallback, useEffect, useState } from 'react'
import { History, Play, Trash2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { LogService } from '@/lib/wails'
import { logger } from '@/lib/logger'

interface SessionLogEntry {
  id: number
  session_id: number | null
  started_at: string
  ended_at: string | null
  data_path: string
}

interface Props {
  sessionId: number
  onPlayback: (recordingPath: string, title: string) => void
  onDeleteRecording: (logId: number) => Promise<void>
  onClose: () => void
  onDeleteDialogOpenChange?: (open: boolean) => void
}

export function formatRecordingTime(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() <= 1) return '时间未知'
  return date.toLocaleString()
}

export default function SessionLog({
  sessionId,
  onPlayback,
  onDeleteRecording,
  onClose,
  onDeleteDialogOpenChange,
}: Props) {
  const [recordings, setRecordings] = useState<SessionLogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [deleteID, setDeleteID] = useState<number | null>(null)
  const [deletingID, setDeletingID] = useState<number | null>(null)
  const [deleteError, setDeleteError] = useState('')

  const loadRecordings = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      const result = await LogService.List(sessionId)
      setRecordings(result as SessionLogEntry[])
    } catch (loadError: unknown) {
      logger.error('SessionLog: load recordings error:', loadError)
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => { void loadRecordings() }, [loadRecordings])

  useEffect(() => {
    onDeleteDialogOpenChange?.(deleteID !== null)
    return () => onDeleteDialogOpenChange?.(false)
  }, [deleteID, onDeleteDialogOpenChange])

  const handleDelete = async (logId: number) => {
    setDeletingID(logId)
    setDeleteError('')
    try {
      await onDeleteRecording(logId)
      setRecordings((current) => current.filter((recording) => recording.id !== logId))
      setDeleteID(null)
    } catch (deleteRecordingError: unknown) {
      setDeleteError(deleteRecordingError instanceof Error
        ? deleteRecordingError.message
        : String(deleteRecordingError))
    } finally {
      setDeletingID(null)
    }
  }

  const openDeleteDialog = (logId: number) => {
    setDeleteError('')
    setDeleteID(logId)
  }

  const handleDeleteDialogChange = (open: boolean) => {
    if (open || deletingID !== null) return
    setDeleteError('')
    setDeleteID(null)
  }

  return (
    <div className="w-80 overflow-hidden rounded-xl border border-border bg-popover shadow-md">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <History className="size-4" aria-hidden="true" />
          录制记录
        </div>
        <span className="text-xs text-muted-foreground">{recordings.length} 条</span>
      </div>
      <div className="max-h-64 overflow-y-auto p-2">
        {loading ? (
          <p className="p-2 text-xs text-muted-foreground">加载中...</p>
        ) : error ? (
          <Alert variant="destructive">
            <AlertDescription>
              {error}
              <Button size="xs" variant="outline" className="ml-2" onClick={() => { void loadRecordings() }}>重试</Button>
            </AlertDescription>
          </Alert>
        ) : recordings.length === 0 ? (
          <p className="p-2 text-xs text-muted-foreground">暂无录制记录</p>
        ) : recordings.map((recording) => (
          <div key={recording.id} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-muted/50">
            <div className="mr-1 flex min-w-0 flex-1 flex-col">
              <span className="truncate text-xs">录制 #{recording.id}</span>
              <span className="text-[10px] text-muted-foreground">{formatRecordingTime(recording.started_at)}</span>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <Button size="xs" variant="ghost" aria-label={`播放录制 #${recording.id}`} onClick={() => {
                onPlayback(recording.data_path, `回放 #${recording.id}`)
                onClose()
              }}><Play aria-hidden="true" /></Button>
              <Button size="xs" variant="ghost" className="text-destructive" aria-label={`删除录制 #${recording.id}`}
                disabled={deletingID !== null}
                onClick={() => openDeleteDialog(recording.id)}><Trash2 aria-hidden="true" /></Button>
            </div>
          </div>
        ))}
      </div>
      <AlertDialog open={deleteID !== null} onOpenChange={handleDeleteDialogChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除录制记录？</AlertDialogTitle>
            <AlertDialogDescription>录制文件将被永久删除。</AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? (
            <Alert variant="destructive">
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingID !== null}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deletingID !== null}
              onClick={() => { if (deleteID !== null) void handleDelete(deleteID) }}
            >
              {deletingID !== null ? '删除中...' : '删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
