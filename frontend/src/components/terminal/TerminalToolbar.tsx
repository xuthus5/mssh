import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'
import { Circle, ClipboardPaste, Copy, FolderOpen, Split, Square, Trash2 } from 'lucide-react'
import SessionLog from '@/components/terminal/SessionLog'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { logger } from '@/lib/logger'
import { LogService } from '@/lib/wails'
import { useAppStore } from '@/store/appStore'

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

interface ToolbarTerminal {
  getSelection: () => string
  paste: (text: string) => void
  clear: () => void
  focus: () => void
}

const actionClass = 'flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors'

function useTerminalAccess(terminalID: string) {
  const getTerminal = useCallback((): ToolbarTerminal | null => {
    const state = useAppStore.getState()
    const targetID = state.activePaneId ?? terminalID
    return state.terminalPool.get(targetID)?.terminal ?? null
  }, [terminalID])
  const restoreFocus = useCallback(() => {
    getTerminal()?.focus()
  }, [getTerminal])
  return { getTerminal, restoreFocus }
}

function useClipboardActions(getTerminal: () => ToolbarTerminal | null, restoreFocus: () => void) {
  const copy = useCallback(async () => {
    const terminal = getTerminal()
    if (!terminal) return
    const selection = terminal.getSelection()
    logger.debug('TerminalToolbar: copy:', selection ? selection.length : 0, 'chars')
    if (selection) await navigator.clipboard.writeText(selection)
    restoreFocus()
  }, [getTerminal, restoreFocus])
  const paste = useCallback(async () => {
    const terminal = getTerminal()
    if (!terminal) return
    const text = await navigator.clipboard.readText()
    logger.debug('TerminalToolbar: paste:', text.length, 'chars')
    terminal.paste(text)
    restoreFocus()
  }, [getTerminal, restoreFocus])
  const clear = useCallback(() => {
    const terminal = getTerminal()
    if (!terminal) return
    logger.debug('TerminalToolbar: clear')
    terminal.clear()
    restoreFocus()
  }, [getTerminal, restoreFocus])
  return { copy, paste, clear }
}

function ClipboardActions({ copy, paste, clear }: { copy: () => void; paste: () => void; clear: () => void }) {
  return <>
    <button type="button" className={actionClass} onClick={copy} title="复制 (Ctrl+Shift+C)">
      <Copy className="h-3 w-3" /><span className="hidden sm:inline">复制</span>
    </button>
    <button type="button" className={actionClass} onClick={paste} title="粘贴 (Ctrl+Shift+V)">
      <ClipboardPaste className="h-3 w-3" /><span className="hidden sm:inline">粘贴</span>
    </button>
    <button type="button" className={actionClass} onClick={clear} title="清屏 (Ctrl+Shift+L)">
      <Trash2 className="h-3 w-3" /><span className="hidden sm:inline">清屏</span>
    </button>
  </>
}

function SplitAction({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  const className = active
    ? 'bg-primary/20 text-primary'
    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
  return <button type="button" className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs transition-colors ${className}`}
    onClick={onToggle} title="分屏">
    <Split className="h-3 w-3" /><span className="hidden sm:inline">分屏</span>
  </button>
}

function RecordingAction({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  const className = active
    ? 'bg-destructive/20 text-destructive'
    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
  return <button type="button" className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs transition-colors ${className}`}
    onClick={onToggle} title={active ? '停止录制' : '开始录制'}>
    {active ? <Square className="h-3 w-3 fill-current" /> : <Circle className="h-3 w-3" />}
    <span className="hidden sm:inline">{active ? '录制中' : '录制'}</span>
  </button>
}

function openPlayback(recordingPath: string, title: string) {
  useAppStore.getState().openTab({ id: `playback-${title}`, title, type: 'playback', recordingPath })
}

async function deleteRecording(logId: number) {
  try {
    await LogService.Delete(logId)
  } catch (err) {
    logger.error('TerminalToolbar: delete recording error:', err)
    throw err
  }
}

interface SessionLogPopoverProps {
  open: boolean
  sessionId: number
  setOpen: Dispatch<SetStateAction<boolean>>
  setBlocked: Dispatch<SetStateAction<boolean>>
  onOpenChange: (open: boolean) => void
}

function SessionLogPopover({ open, sessionId, setOpen, setBlocked, onOpenChange }: SessionLogPopoverProps) {
  return <Popover open={open} onOpenChange={onOpenChange}>
    <PopoverTrigger render={<button type="button"
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      title="录制记录" />}>
      记录
    </PopoverTrigger>
    <PopoverContent align="end" sideOffset={4} className="w-auto bg-transparent p-0 shadow-none ring-0">
      <PopoverTitle className="sr-only">录制记录</PopoverTitle>
      <SessionLog sessionId={sessionId} onClose={() => setOpen(false)}
        onDeleteDialogOpenChange={setBlocked} onPlayback={openPlayback} onDeleteRecording={deleteRecording} />
    </PopoverContent>
  </Popover>
}

interface ToolbarActionsProps extends Pick<TerminalToolbarProps, 'sessionId' | 'isRecording' | 'onToggleRecording' | 'onOpenFiles' | 'onToggleSplit' | 'split'> {
  clipboard: ReturnType<typeof useClipboardActions>
  logOpen: boolean
  setLogOpen: Dispatch<SetStateAction<boolean>>
  setLogBlocked: Dispatch<SetStateAction<boolean>>
  onLogOpenChange: (open: boolean) => void
}

function ToolbarActions(props: ToolbarActionsProps) {
  return <div className="flex items-center gap-0.5 ml-auto">
    <ClipboardActions {...props.clipboard} />
    <div className="w-px h-4 bg-border mx-0.5" />
    <button type="button" className={actionClass} onClick={props.onOpenFiles} title="文件管理">
      <FolderOpen className="h-3 w-3" /><span className="hidden sm:inline">文件</span>
    </button>
    <div className="w-px h-4 bg-border mx-0.5" />
    <SplitAction active={props.split} onToggle={props.onToggleSplit} />
    <div className="w-px h-4 bg-border mx-0.5" />
    <RecordingAction active={props.isRecording} onToggle={props.onToggleRecording} />
    <SessionLogPopover open={props.logOpen} sessionId={props.sessionId} setOpen={props.setLogOpen}
      setBlocked={props.setLogBlocked} onOpenChange={props.onLogOpenChange} />
  </div>
}

export function TerminalToolbar(props: TerminalToolbarProps) {
  const [showSessionLog, setShowSessionLog] = useState(false)
  const [sessionLogBlocked, setSessionLogBlocked] = useState(false)
  const terminal = useTerminalAccess(props.terminalID)
  const clipboard = useClipboardActions(terminal.getTerminal, terminal.restoreFocus)
  const handleSessionLogOpenChange = useCallback((open: boolean) => {
    if (!open && sessionLogBlocked) return
    setShowSessionLog(open)
  }, [sessionLogBlocked])
  return <div className="relative flex h-8 flex-shrink-0 items-center gap-1 bg-muted/30 px-2">
    <span className="text-xs text-muted-foreground truncate mr-2">{props.hostname ?? 'Terminal'}</span>
    <ToolbarActions {...props} clipboard={clipboard} logOpen={showSessionLog} setLogOpen={setShowSessionLog}
      setLogBlocked={setSessionLogBlocked} onLogOpenChange={handleSessionLogOpenChange} />
  </div>
}
