import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Circle, Square, Play } from 'lucide-react'

export interface RecordingInfo {
  id: string
  sessionId: string
  sessionName: string
  startedAt: string
  endedAt: string | null
  sizeBytes: number
}

interface Props {
  isRecording: boolean
  recordings: RecordingInfo[]
  onToggleRecording: () => void
  onPlayback: (recordingId: string) => void
  onDeleteRecording: (recordingId: string) => void
}

export default function SessionLog({
  isRecording,
  recordings,
  onToggleRecording,
  onPlayback,
  onDeleteRecording: _onDeleteRecording,
}: Props) {
  const [showList, setShowList] = useState(false)

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
        <div className="absolute top-8 right-2 z-50 w-64 max-h-48 overflow-y-auto rounded-lg border border-border bg-popover shadow-md p-2">
          {recordings.length === 0 ? (
            <p className="text-xs text-muted-foreground p-2">暂无录制记录</p>
          ) : (
            recordings.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between px-2 py-1 rounded hover:bg-muted/50"
              >
                <div className="flex flex-col">
                  <span className="text-xs">{r.sessionName}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {r.startedAt}
                  </span>
                </div>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => onPlayback(r.id)}
                >
                  <Play className="h-3 w-3" />
                </Button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
