import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Circle, Square, Play, Trash2 } from 'lucide-react'
import { LogService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'

interface SessionLogEntry {
  id: number
  session_id: number | null
  started_at: string
  ended_at: string | null
  data_path: string
}

interface Props {
  sessionId: number
  isRecording: boolean
  onToggleRecording: () => void
  onPlayback: (recordingPath: string, title: string) => void
  onDeleteRecording: (logId: number) => Promise<void>
}

export default function SessionLog({
  sessionId,
  isRecording,
  onToggleRecording,
  onPlayback,
  onDeleteRecording,
}: Props) {
  const [showList, setShowList] = useState(false)
  const [recordings, setRecordings] = useState<SessionLogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [deleteID, setDeleteID] = useState<number | null>(null)

  const loadRecordings = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      const result = await LogService.List(sessionId)
      setRecordings(result as SessionLogEntry[])
    } catch (err) {
      logger.error('SessionLog: load recordings error:', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    if (showList) {
      loadRecordings()
    }
  }, [showList, loadRecordings])

  const handleDelete = async (logId: number) => {
    try {
      await onDeleteRecording(logId)
      setRecordings((prev) => prev.filter((r) => r.id !== logId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const formatTime = (ts: string) => {
    try {
      return new Date(ts).toLocaleString()
    } catch {
      return ts
    }
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs transition-colors ${
          isRecording
            ? 'bg-destructive/20 text-destructive'
            : 'hover:bg-muted/50 text-muted-foreground'
        }`}
        onClick={onToggleRecording}
        title={isRecording ? '停止录制' : '开始录制'}
      >
        {isRecording ? (
          <Square className="h-3 w-3 fill-current" />
        ) : (
          <Circle className="h-3 w-3" />
        )}
        {isRecording ? '录制中' : '录制'}
      </button>
      <button
        type="button"
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
        onClick={() => setShowList(!showList)}
      >
        记录 ({recordings.length})
      </button>
      {showList && (
        <div className="absolute top-8 right-2 z-50 w-72 max-h-64 overflow-y-auto rounded-lg border border-border bg-popover shadow-md p-2">
          {loading ? (
            <p className="text-xs text-muted-foreground p-2">加载中...</p>
          ) : error ? (
            <Alert variant="destructive"><AlertDescription>{error}<Button size="xs" variant="outline" className="ml-2" onClick={() => { void loadRecordings() }}>重试</Button></AlertDescription></Alert>
          ) : recordings.length === 0 ? (
            <p className="text-xs text-muted-foreground p-2">暂无录制记录</p>
          ) : (
            recordings.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-muted/50"
              >
                <div className="flex flex-col min-w-0 flex-1 mr-1">
                  <span className="text-xs truncate">
                    录制 #{r.id}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatTime(r.started_at)}
                  </span>
                </div>
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      onPlayback(r.data_path, `回放 #${r.id}`)
                      setShowList(false)
                    }}
                  >
                    <Play className="h-3 w-3" />
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => setDeleteID(r.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
      <AlertDialog open={deleteID !== null} onOpenChange={(open) => { if (!open) setDeleteID(null) }}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除录制记录？</AlertDialogTitle><AlertDialogDescription>录制文件将被永久删除。</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { if (deleteID !== null) void handleDelete(deleteID); setDeleteID(null) }}>删除</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
