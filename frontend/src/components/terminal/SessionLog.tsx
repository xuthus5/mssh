import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { History, Play, Trash2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { logger } from '@/lib/logger'
import { LogService } from '@/lib/wails'
import { t } from '@/i18n'


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
  if (Number.isNaN(date.getTime())) return t('时间未知')
  return date.toLocaleString()
}

function useRecordings(sessionId: number) {
  const [recordings, setRecordings] = useState<SessionLogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const loadRecordings = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      const result = await LogService.List(sessionId)
      setRecordings(result as SessionLogEntry[])
    } catch (loadError: unknown) {
      logger.error('SessionLog: load recordings error:', loadError)
      const message = loadError instanceof Error ? loadError.message : String(loadError)
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [sessionId])
  useEffect(() => { void loadRecordings() }, [loadRecordings])
  return { recordings, setRecordings, loading, error, loadRecordings }
}

function useDeleteDialogNotification(deleteID: number | null, onOpenChange?: (open: boolean) => void) {
  useEffect(() => {
    onOpenChange?.(deleteID !== null)
    return () => onOpenChange?.(false)
  }, [deleteID, onOpenChange])
}

function useRecordingDeletion(
  onDeleteRecording: (logId: number) => Promise<void>,
  setRecordings: Dispatch<SetStateAction<SessionLogEntry[]>>,
) {
  const [deleteID, setDeleteID] = useState<number | null>(null)
  const [deletingID, setDeletingID] = useState<number | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const handleDelete = async (logId: number) => {
    setDeletingID(logId)
    setDeleteError('')
    try {
      await onDeleteRecording(logId)
      setRecordings((current) => current.filter((recording) => recording.id !== logId))
      setDeleteID(null)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      setDeleteError(message)
    } finally {
      setDeletingID(null)
    }
  }
  const openDeleteDialog = (logId: number) => {
    setDeleteError('')
    setDeleteID(logId)
  }
  const handleDialogChange = (open: boolean) => {
    if (open || deletingID !== null) return
    setDeleteError('')
    setDeleteID(null)
  }
  return { deleteID, deletingID, deleteError, handleDelete, openDeleteDialog, handleDialogChange }
}

function SessionLogHeader({ count }: { count: number }) {
  return <div className="flex items-center justify-between border-b border-border px-3 py-2">
    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
      <History className="size-4" aria-hidden="true" />{t('录制记录')}
    </div>
    <span className="text-xs text-muted-foreground">{count} {t('条')}</span>
  </div>
}

interface RecordingRowProps {
  recording: SessionLogEntry
  deleteDisabled: boolean
  onPlayback: Props['onPlayback']
  onClose: Props['onClose']
  onDelete: (logId: number) => void
}

function RecordingRow({ recording, deleteDisabled, onPlayback, onClose, onDelete }: RecordingRowProps) {
  const play = () => {
    onPlayback(recording.data_path, t('回放 #${}', recording.id))
    onClose()
  }
  return <div className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-muted/50">
    <div className="mr-1 flex min-w-0 flex-1 flex-col">
      <span className="truncate text-xs">{t('录制 #')}{recording.id}</span>
      <span className="text-[10px] text-muted-foreground">{formatRecordingTime(recording.started_at)}</span>
    </div>
    <div className="flex shrink-0 items-center gap-0.5">
      <Button size="xs" variant="ghost" aria-label={t('播放录制 #${}', recording.id)} onClick={play}>
        <Play aria-hidden="true" />
      </Button>
      <Button size="xs" variant="ghost" className="text-destructive" aria-label={t('删除录制 #${}', recording.id)}
        disabled={deleteDisabled} onClick={() => onDelete(recording.id)}>
        <Trash2 aria-hidden="true" />
      </Button>
    </div>
  </div>
}

interface RecordingListProps {
  recordings: SessionLogEntry[]
  loading: boolean
  error: string
  deleting: boolean
  onRetry: () => void
  onPlayback: Props['onPlayback']
  onClose: Props['onClose']
  onDelete: (logId: number) => void
}

function RecordingList(props: RecordingListProps) {
  if (props.loading) return <p className="p-2 text-xs text-muted-foreground">{t('加载中...')}</p>
  if (props.error) return <Alert variant="destructive"><AlertDescription>
    {props.error}
    <Button size="xs" variant="outline" className="ml-2" onClick={props.onRetry}>{t('重试')}</Button>
  </AlertDescription></Alert>
  if (props.recordings.length === 0) return <p className="p-2 text-xs text-muted-foreground">{t('暂无录制记录')}</p>
  return props.recordings.map((recording) => <RecordingRow key={recording.id} recording={recording}
    deleteDisabled={props.deleting} onPlayback={props.onPlayback} onClose={props.onClose} onDelete={props.onDelete} />)
}

interface DeleteDialogProps {
  deleteID: number | null
  deletingID: number | null
  error: string
  onOpenChange: (open: boolean) => void
  onDelete: (logId: number) => Promise<void>
}

function DeleteRecordingDialog({ deleteID, deletingID, error, onOpenChange, onDelete }: DeleteDialogProps) {
  return <AlertDialog open={deleteID !== null} onOpenChange={onOpenChange}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{t('删除录制记录？')}</AlertDialogTitle>
        <AlertDialogDescription>{t('录制文件将被永久删除。')}</AlertDialogDescription>
      </AlertDialogHeader>
      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={deletingID !== null}>{t('取消')}</AlertDialogCancel>
        <AlertDialogAction variant="destructive" disabled={deletingID !== null}
          onClick={() => { if (deleteID !== null) void onDelete(deleteID).catch(() => undefined) }}>
          {deletingID !== null ? t('删除中...') : t('删除')}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}

export default function SessionLog(props: Props) {
  const list = useRecordings(props.sessionId)
  const deletion = useRecordingDeletion(props.onDeleteRecording, list.setRecordings)
  useDeleteDialogNotification(deletion.deleteID, props.onDeleteDialogOpenChange)
  return <div className="w-80 overflow-hidden rounded-xl border border-border bg-popover shadow-md">
    <SessionLogHeader count={list.recordings.length} />
    <div className="max-h-64 overflow-y-auto p-2">
      <RecordingList recordings={list.recordings} loading={list.loading} error={list.error}
        deleting={deletion.deletingID !== null} onRetry={() => { void list.loadRecordings() }}
        onPlayback={props.onPlayback} onClose={props.onClose} onDelete={deletion.openDeleteDialog} />
    </div>
    <DeleteRecordingDialog deleteID={deletion.deleteID} deletingID={deletion.deletingID}
      error={deletion.deleteError} onOpenChange={deletion.handleDialogChange} onDelete={deletion.handleDelete} />
  </div>
}
