import { useCallback, useState } from 'react'
import { Copy, ClipboardPaste, Trash2, Circle, Square, FolderOpen, Split } from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { LogService } from '@/lib/wails'
import SessionLog from '@/components/terminal/SessionLog'
import { logger } from '@/lib/logger'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'

interface TerminalToolbarProps {
  terminalID: string
  sessionId: number
  isRecording: boolean
  recordingLogId: number | null
  onToggleRecording: () => void
  hostname?: string
  onOpenFiles: () => void
  onToggleSplit: () => void
  split: boolean
}

export function TerminalToolbar({
  terminalID,
  sessionId,
  isRecording,
  onToggleRecording,
  hostname,
  onOpenFiles,
  onToggleSplit,
  split,
}: TerminalToolbarProps) {
  const [showSessionLog, setShowSessionLog] = useState(false)
  const [sessionLogBlocked, setSessionLogBlocked] = useState(false)

  const getTerminal = useCallback(() => {
    const state = useAppStore.getState()
    const targetID = state.activePaneId ?? terminalID
    const entry = state.terminalPool.get(targetID)
    return entry?.terminal ?? null
  }, [terminalID])

  const restoreFocus = useCallback(() => {
    getTerminal()?.focus()
  }, [getTerminal])

  const handleCopy = useCallback(async () => {
    const term = getTerminal()
    if (!term) return
    const selection = term.getSelection()
    logger.debug('TerminalToolbar: copy:', selection ? selection.length : 0, 'chars')
    if (selection) {
      await navigator.clipboard.writeText(selection)
    }
    restoreFocus()
  }, [getTerminal, restoreFocus])

  const handlePaste = useCallback(async () => {
    const term = getTerminal()
    if (!term) return
    const text = await navigator.clipboard.readText()
    logger.debug('TerminalToolbar: paste:', text.length, 'chars')
    term.paste(text)
    restoreFocus()
  }, [getTerminal, restoreFocus])

  const handleClear = useCallback(() => {
    const term = getTerminal()
    if (!term) return
    logger.debug('TerminalToolbar: clear')
    term.clear()
    restoreFocus()
  }, [getTerminal, restoreFocus])

  const handleSessionLogOpenChange = useCallback((open: boolean) => {
    if (!open && sessionLogBlocked) return
    setShowSessionLog(open)
  }, [sessionLogBlocked])

  return (
    <div className="relative flex items-center gap-1 h-8 px-2 bg-muted/30 border-b flex-shrink-0">
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
            split
              ? 'bg-primary/20 text-primary'
              : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
          }`}
          onClick={onToggleSplit}
          title="分屏"
        >
          <Split className="h-3 w-3" />
          <span className="hidden sm:inline">分屏</span>
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

        <Popover open={showSessionLog} onOpenChange={handleSessionLogOpenChange}>
          <PopoverTrigger
            render={
              <button
                type="button"
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                title="录制记录"
              />
            }
          >
            记录
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={4}
            className="w-auto bg-transparent p-0 shadow-none ring-0"
          >
            <PopoverTitle className="sr-only">录制记录</PopoverTitle>
            <SessionLog
              sessionId={sessionId}
              onClose={() => setShowSessionLog(false)}
              onDeleteDialogOpenChange={setSessionLogBlocked}
              onPlayback={(recordingPath: string, title: string) => {
                const { openTab } = useAppStore.getState()
                openTab({ id: `playback-${title}`, title, type: 'playback', terminalId: recordingPath })
              }}
              onDeleteRecording={async (logId: number) => {
                try {
                  await LogService.Delete(logId)
                } catch (err) {
                  logger.error('TerminalToolbar: delete recording error:', err)
                  throw err
                }
              }}
            />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
