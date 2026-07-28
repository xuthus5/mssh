import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { History, Play, Trash2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { logger } from '@/lib/logger'
import { LogService } from '@/lib/wails'
import { t } from '@/i18n'
import {
  emitRecordingCatalogChanged,
  onRecordingCatalogChanged,
  runRecordingMutation,
  useRecordingMutationState,
} from '@/lib/recordingMutationCoordinator'


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

function useRecordings(sessionId: number, source: symbol) {
  const [recordings, setRecordings] = useState<SessionLogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const lifecycle = useRef(0)
  const requestID = useRef(0)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [])
  const loadRecordings = useCallback(async () => {
    const lifecycleToken = lifecycle.current
    const request = ++requestID.current
    const isCurrent = () => lifecycle.current === lifecycleToken && requestID.current === request
    setLoading(true)
    setError('')
    try {
      const result = await LogService.List(sessionId)
      if (isCurrent()) setRecordings(result as SessionLogEntry[])
    } catch (loadError: unknown) {
      if (!isCurrent()) return
      logger.error('SessionLog: load recordings error:', loadError)
      const message = loadError instanceof Error ? loadError.message : String(loadError)
      setError(message)
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [sessionId])
  useEffect(() => {
    requestID.current++
    setRecordings([])
    void loadRecordings()
  }, [loadRecordings])
  useEffect(() => onRecordingCatalogChanged(sessionId, source, () => {
    void loadRecordings()
  }), [loadRecordings, sessionId, source])
  return { recordings, setRecordings, loading, error, loadRecordings }
}

function useDeleteDialogNotification(deleteID: number | null, onOpenChange?: (open: boolean) => void) {
  useEffect(() => {
    onOpenChange?.(deleteID !== null)
    return () => onOpenChange?.(false)
  }, [deleteID, onOpenChange])
}

function useRecordingDeleteRuntime({ sessionId, setDeleteID, setDeletingID, setDeleteError }: {
  sessionId: number
  setDeleteID: (id: number | null) => void
  setDeletingID: (id: number | null) => void
  setDeleteError: (error: string) => void
}) {
  const lifecycle = useRef(0)
  const scopeGeneration = useRef(0)
  const requestID = useRef(0)
  const deleteActive = useRef(false)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [])
  useEffect(() => {
    scopeGeneration.current++
    setDeleteID(null)
    if (!deleteActive.current) setDeletingID(null)
    setDeleteError('')
  }, [sessionId, setDeleteError, setDeleteID, setDeletingID])
  return { lifecycle, scopeGeneration, requestID, deleteActive }
}

type RecordingDeleteRuntime = ReturnType<typeof useRecordingDeleteRuntime>

function createRecordingDeleteHandler(context: {
  runtime: RecordingDeleteRuntime
  onDeleteRecording: (logId: number) => Promise<void>
  setRecordings: Dispatch<SetStateAction<SessionLogEntry[]>>
  setDeleteID: (id: number | null) => void
  setDeletingID: (id: number | null) => void
  setDeleteError: (error: string) => void
  sessionId: number
  source: symbol
}) {
  return async (logId: number) => {
    if (context.runtime.deleteActive.current) return
    context.runtime.deleteActive.current = true
    const lifecycleToken = context.runtime.lifecycle.current
    const generation = context.runtime.scopeGeneration.current
    const request = ++context.runtime.requestID.current
    const isLatest = () => context.runtime.lifecycle.current === lifecycleToken
      && context.runtime.requestID.current === request
    const isCurrent = () => isLatest() && context.runtime.scopeGeneration.current === generation
    context.setDeletingID(logId); context.setDeleteError('')
    try {
      await runRecordingMutation(logId, () => context.onDeleteRecording(logId))
      emitRecordingCatalogChanged(context.sessionId, context.source)
      if (!isCurrent()) return
      context.setRecordings((current) => current.filter((recording) => recording.id !== logId))
      context.setDeleteID(null)
    } catch (error: unknown) {
      if (isCurrent()) context.setDeleteError(error instanceof Error ? error.message : String(error))
    } finally {
      if (context.runtime.requestID.current === request) context.runtime.deleteActive.current = false
      if (isLatest()) context.setDeletingID(null)
    }
  }
}

function useRecordingDeletion({ onDeleteRecording, setRecordings, sessionId, source }: {
  onDeleteRecording: (logId: number) => Promise<void>
  setRecordings: Dispatch<SetStateAction<SessionLogEntry[]>>
  sessionId: number
  source: symbol
}) {
  const [deleteID, setDeleteID] = useState<number | null>(null)
  const [deletingID, setDeletingID] = useState<number | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const busyRecordingIDs = useRecordingMutationState((state) => state.busyRecordingIDs)
  const runtime = useRecordingDeleteRuntime({ sessionId, setDeleteID, setDeletingID, setDeleteError })
  const handleDelete = createRecordingDeleteHandler({ runtime, onDeleteRecording, setRecordings,
    setDeleteID, setDeletingID, setDeleteError, sessionId, source })
  const openDeleteDialog = (logId: number) => {
    if (runtime.deleteActive.current) return
    runtime.scopeGeneration.current++
    runtime.requestID.current++
    setDeleteError('')
    setDeleteID(logId)
  }
  const handleDialogChange = (open: boolean) => {
    if (open || deletingID !== null) return
    runtime.scopeGeneration.current++
    runtime.requestID.current++
    setDeleteError('')
    setDeleteID(null)
  }
  return { deleteID, deletingID, deleteError, busyRecordingIDs,
    handleDelete, openDeleteDialog, handleDialogChange }
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
  operationDisabled: boolean
  onPlayback: Props['onPlayback']
  onClose: Props['onClose']
  onDelete: (logId: number) => void
}

function RecordingRow({ recording, operationDisabled, onPlayback, onClose, onDelete }: RecordingRowProps) {
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
      <Button size="xs" variant="ghost" disabled={operationDisabled} aria-label={t('播放录制 #${}', recording.id)} onClick={play}>
        <Play aria-hidden="true" />
      </Button>
      <Button size="xs" variant="ghost" className="text-destructive" aria-label={t('删除录制 #${}', recording.id)}
        disabled={operationDisabled} onClick={() => onDelete(recording.id)}>
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
  busyRecordingIDs: ReadonlySet<number>
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
    operationDisabled={props.deleting || props.busyRecordingIDs.has(recording.id)}
    onPlayback={props.onPlayback} onClose={props.onClose} onDelete={props.onDelete} />)
}

interface DeleteDialogProps {
  deleteID: number | null
  deletingID: number | null
  deleteBlocked: boolean
  error: string
  onOpenChange: (open: boolean) => void
  onDelete: (logId: number) => Promise<void>
}

function DeleteRecordingDialog({ deleteID, deletingID, deleteBlocked, error, onOpenChange, onDelete }: DeleteDialogProps) {
  return <AlertDialog open={deleteID !== null} onOpenChange={onOpenChange}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{t('删除录制记录？')}</AlertDialogTitle>
        <AlertDialogDescription>{t('录制文件将被永久删除。')}</AlertDialogDescription>
      </AlertDialogHeader>
      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={deletingID !== null}>{t('取消')}</AlertDialogCancel>
        <AlertDialogAction variant="destructive" disabled={deleteBlocked}
          onClick={() => { if (deleteID !== null) void onDelete(deleteID).catch(() => undefined) }}>
          {deleteBlocked ? t('删除中...') : t('删除')}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}

export default function SessionLog(props: Props) {
  const source = useRef(Symbol('session-log')).current
  const list = useRecordings(props.sessionId, source)
  const deletion = useRecordingDeletion({ onDeleteRecording: props.onDeleteRecording,
    setRecordings: list.setRecordings, sessionId: props.sessionId, source })
  useDeleteDialogNotification(deletion.deleteID, props.onDeleteDialogOpenChange)
  return <div className="w-80 overflow-hidden rounded-xl border border-border bg-popover shadow-md">
    <SessionLogHeader count={list.recordings.length} />
    <div className="max-h-64 overflow-y-auto p-2">
      <RecordingList recordings={list.recordings} loading={list.loading} error={list.error}
        deleting={deletion.deletingID !== null} onRetry={() => { void list.loadRecordings() }}
        busyRecordingIDs={deletion.busyRecordingIDs} onPlayback={props.onPlayback}
        onClose={props.onClose} onDelete={deletion.openDeleteDialog} />
    </div>
    <DeleteRecordingDialog deleteID={deletion.deleteID} deletingID={deletion.deletingID}
      deleteBlocked={deletion.deletingID !== null || (deletion.deleteID !== null
        && deletion.busyRecordingIDs.has(deletion.deleteID))}
      error={deletion.deleteError} onOpenChange={deletion.handleDialogChange} onDelete={deletion.handleDelete} />
  </div>
}
