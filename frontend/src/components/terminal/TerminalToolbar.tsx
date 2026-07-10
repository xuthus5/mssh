import { useCallback, useState } from 'react'
import { Copy, ClipboardPaste, Trash2, Circle, Square, FolderOpen } from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import SessionLog from '@/components/terminal/SessionLog'

interface TerminalToolbarProps {
  terminalID: string
  isRecording: boolean
  onToggleRecording: () => void
  hostname?: string
  onOpenFiles: () => void
}

export function TerminalToolbar({
  terminalID,
  isRecording,
  onToggleRecording,
  hostname,
  onOpenFiles,
}: TerminalToolbarProps) {
  const [showSessionLog, setShowSessionLog] = useState(false)

  const getTerminal = useCallback(() => {
    const entry = useAppStore.getState().terminalPool.get(terminalID)
    return entry?.terminal ?? null
  }, [terminalID])

  const handleCopy = useCallback(async () => {
    const term = getTerminal()
    if (!term) return
    const selection = term.getSelection()
    console.log('[TerminalToolbar] copy:', selection ? selection.length : 0, 'chars')
    if (selection) {
      await navigator.clipboard.writeText(selection)
    }
  }, [getTerminal])

  const handlePaste = useCallback(async () => {
    const term = getTerminal()
    if (!term) return
    const text = await navigator.clipboard.readText()
    console.log('[TerminalToolbar] paste:', text.length, 'chars')
    term.paste(text)
  }, [getTerminal])

  const handleClear = useCallback(() => {
    const term = getTerminal()
    if (!term) return
    console.log('[TerminalToolbar] clear')
    term.clear()
  }, [getTerminal])

  return (
    <div className="flex items-center gap-1 h-8 px-2 bg-muted/30 border-b flex-shrink-0">
      <span className="text-xs text-muted-foreground truncate mr-2">
        {hostname ?? 'Terminal'}
      </span>

      <div className="flex items-center gap-0.5 ml-auto">
        <button
          type="button"
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
          onClick={handleCopy}
          title="复制 (Ctrl+Shift+C)"
        >
          <Copy className="h-3 w-3" />
          <span className="hidden sm:inline">复制</span>
        </button>

        <button
          type="button"
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
          onClick={handlePaste}
          title="粘贴 (Ctrl+Shift+V)"
        >
          <ClipboardPaste className="h-3 w-3" />
          <span className="hidden sm:inline">粘贴</span>
        </button>

        <button
          type="button"
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
          onClick={handleClear}
          title="清屏 (Ctrl+Shift+L)"
        >
          <Trash2 className="h-3 w-3" />
          <span className="hidden sm:inline">清屏</span>
        </button>

        <div className="w-px h-4 bg-border mx-0.5" />

        <button
          type="button"
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
          onClick={onOpenFiles}
          title="文件管理"
        >
          <FolderOpen className="h-3 w-3" />
          <span className="hidden sm:inline">文件</span>
        </button>

        <div className="w-px h-4 bg-border mx-0.5" />

        <button
          type="button"
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs transition-colors ${
            isRecording
              ? 'bg-destructive/20 text-destructive'
              : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
          }`}
          onClick={onToggleRecording}
          title={isRecording ? '停止录制' : '开始录制'}
        >
          {isRecording ? (
            <Square className="h-3 w-3 fill-current" />
          ) : (
            <Circle className="h-3 w-3" />
          )}
          <span className="hidden sm:inline">
            {isRecording ? '录制中' : '录制'}
          </span>
        </button>

        <button
          type="button"
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
          onClick={() => setShowSessionLog(!showSessionLog)}
          title="录制记录"
        >
          记录
        </button>
      </div>

      {showSessionLog && (
        <div className="absolute top-8 right-2 z-50">
          <SessionLog
            isRecording={isRecording}
            recordings={[]}
            onToggleRecording={onToggleRecording}
            onPlayback={(_recordingId: string) => {
              console.log('[TerminalToolbar] playback', _recordingId)
            }}
            onDeleteRecording={(_recordingId: string) => {
              console.log('[TerminalToolbar] delete recording', _recordingId)
            }}
          />
        </div>
      )}
    </div>
  )
}
