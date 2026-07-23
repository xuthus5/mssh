import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'
import { Activity, Bot, ChevronDown, Circle, ClipboardPaste, Columns2, Copy, FolderOpen, History, Network, PenLine, Rows2, Search, Split, Square, Trash2 } from 'lucide-react'
import SessionLog from '@/components/terminal/SessionLog'
import TunnelDialog from '@/components/session/TunnelDialog'
import { useTunnelManager } from '@/hooks/useTunnelManager'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { logger } from '@/lib/logger'
import { LogService } from '@/lib/wails'
import { useAppStore } from '@/store/appStore'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { SplitDirection } from '@/components/terminal/splitTree'
import { getClipboard } from '@/lib/clipboard'
import { useShortcutStore } from '@/store/shortcutStore'
import { formatChordDisplay } from '@/lib/shortcuts'
import { t } from '@/i18n'
import { SerialSignalToolbar } from '@/components/terminal/SerialSignalToolbar'


interface TerminalToolbarProps {
  terminalID: string
  sessionId: number
  isRecording: boolean
  recordingLogId: number | null
  onToggleRecording: () => void
  hostname?: string
  onOpenFiles?: () => void
  filesSupported?: boolean
  serialControls?: boolean
  onSplit: (direction: SplitDirection) => void
  splitDisabled: boolean
  paneCount: number
  searchOpen: boolean
  onToggleSearch: () => void
  composeOpen?: boolean
  onToggleCompose?: () => void
  onOpenHistory?: () => void
  onOpenSystem?: () => void
  onOpenAI?: () => void
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
    if (selection) await getClipboard().writeText(selection)
    restoreFocus()
  }, [getTerminal, restoreFocus])
  const paste = useCallback(async () => {
    const terminal = getTerminal()
    if (!terminal) return
    const text = await getClipboard().readText()
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
  const bindings = useShortcutStore((state) => state.bindings)
  const copyHint = formatChordDisplay(bindings['copy-selection'])
  const pasteHint = formatChordDisplay(bindings['paste-clipboard'])
  const clearHint = formatChordDisplay(bindings['clear-terminal'])
  return <>
    <button type="button" className={actionClass} onClick={copy} title={`${t('复制')} (${copyHint})`}>
      <Copy className="h-3 w-3" /><span className="hidden sm:inline">{t('复制')}</span>
    </button>
    <button type="button" className={actionClass} onClick={paste} title={`${t('粘贴')} (${pasteHint})`}>
      <ClipboardPaste className="h-3 w-3" /><span className="hidden sm:inline">{t('粘贴')}</span>
    </button>
    <button type="button" className={actionClass} onClick={clear} title={`${t('清屏')} (${clearHint})`}>
      <Trash2 className="h-3 w-3" /><span className="hidden sm:inline">{t('清屏')}</span>
    </button>
  </>
}

function SplitAction({ disabled, paneCount, onSplit }: { disabled: boolean; paneCount: number; onSplit: (direction: SplitDirection) => void }) {
  const [open, setOpen] = useState(false)
  const title = paneCount >= 8 ? t('已达到 8 个终端窗格上限') : t('创建分屏')
  return <DropdownMenu open={open} onOpenChange={setOpen}>
    <DropdownMenuTrigger render={<button type="button" disabled={disabled}
      className={`${actionClass} disabled:pointer-events-none disabled:opacity-45`} title={title} onClick={() => setOpen(true)} />}>
      <Split className="h-3 w-3" /><span className="hidden sm:inline">{t('分屏')}</span><ChevronDown className="size-3" />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-36">
      <DropdownMenuItem onClick={() => onSplit('horizontal')}><Columns2 />{t('向右分屏')}</DropdownMenuItem>
      <DropdownMenuItem onClick={() => onSplit('vertical')}><Rows2 />{t('向下分屏')}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
}

function RecordingAction({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  const className = active
    ? 'bg-destructive/20 text-destructive'
    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
  return <button type="button" className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs transition-colors ${className}`}
    onClick={onToggle} title={active ? t('停止录制') : t('开始录制')}>
    {active ? <Square className="h-3 w-3 fill-current" /> : <Circle className="h-3 w-3" />}
    <span className="hidden sm:inline">{active ? t('录制中') : t('录制')}</span>
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
      title={t('录制记录')} />}>
      {t('记录')}
    </PopoverTrigger>
    <PopoverContent align="end" sideOffset={4} className="w-auto bg-transparent p-0 shadow-none ring-0">
      <PopoverTitle className="sr-only">{t('录制记录')}</PopoverTitle>
      <SessionLog sessionId={sessionId} onClose={() => setOpen(false)}
        onDeleteDialogOpenChange={setBlocked} onPlayback={openPlayback} onDeleteRecording={deleteRecording} />
    </PopoverContent>
  </Popover>
}

interface ToolbarActionsProps extends Pick<TerminalToolbarProps, 'sessionId' | 'isRecording' | 'onToggleRecording' | 'onOpenFiles' | 'filesSupported' | 'onSplit' | 'splitDisabled' | 'paneCount' | 'searchOpen' | 'onToggleSearch' | 'composeOpen' | 'onToggleCompose'> {
  clipboard: ReturnType<typeof useClipboardActions>
  logOpen: boolean
  setLogOpen: Dispatch<SetStateAction<boolean>>
  setLogBlocked: Dispatch<SetStateAction<boolean>>
  onLogOpenChange: (open: boolean) => void
  onOpenTunnels: () => void
  onOpenHistory: () => void
  onOpenSystem: () => void
  onOpenAI: () => void
}

function ToolbarActions(props: ToolbarActionsProps) {
  return <div className="flex items-center gap-0.5 ml-auto">
    <ClipboardActions {...props.clipboard} />
    <button type="button" className={props.searchOpen ? `${actionClass} bg-primary/15 text-primary` : actionClass}
      onClick={props.onToggleSearch} title={props.searchOpen ? t('关闭终端搜索') : t('搜索终端内容')}>
      <Search className="h-3 w-3" /><span className="hidden sm:inline">{t('搜索')}</span>
    </button>
    <button type="button" className={actionClass} onClick={props.onOpenHistory} title={t('命令历史')}><History className="h-3 w-3" /><span className="hidden sm:inline">{t('历史')}</span></button>
    <div className="w-px h-4 bg-border mx-0.5" />
    {props.filesSupported !== false && props.onOpenFiles ? (
      <button type="button" className={actionClass} onClick={props.onOpenFiles} title={t('文件管理')}>
        <FolderOpen className="h-3 w-3" /><span className="hidden sm:inline">{t('文件')}</span>
      </button>
    ) : null}
    <button type="button" className={props.composeOpen ? `${actionClass} bg-primary/15 text-primary` : actionClass}
      onClick={props.onToggleCompose} title={props.composeOpen ? t('关闭撰写面板') : t('撰写终端内容')}>
      <PenLine className="h-3 w-3" /><span className="hidden sm:inline">{t('撰写')}</span>
    </button>
    {props.filesSupported !== false ? (
      <button type="button" className={actionClass} onClick={props.onOpenAI} title={t('AI 运维')}><Bot className="h-3 w-3" /><span className="hidden sm:inline">AI</span></button>
    ) : null}
    {props.filesSupported !== false ? (
      <button type="button" className={actionClass} onClick={props.onOpenTunnels} title={t('隧道管理')}>
        <Network className="h-3 w-3" /><span className="hidden sm:inline">{t('隧道')}</span>
      </button>
    ) : null}
    {props.filesSupported !== false ? (
      <button type="button" className={actionClass} onClick={props.onOpenSystem} title={t('系统监控')}><Activity className="h-3 w-3" /><span className="hidden sm:inline">{t('系统')}</span></button>
    ) : null}
    <div className="w-px h-4 bg-border mx-0.5" />
    <SplitAction disabled={props.splitDisabled} paneCount={props.paneCount} onSplit={props.onSplit} />
    <div className="w-px h-4 bg-border mx-0.5" />
    <RecordingAction active={props.isRecording} onToggle={props.onToggleRecording} />
    <SessionLogPopover open={props.logOpen} sessionId={props.sessionId} setOpen={props.setLogOpen}
      setBlocked={props.setLogBlocked} onOpenChange={props.onLogOpenChange} />
  </div>
}

export function TerminalToolbar(props: TerminalToolbarProps) {
  const [showSessionLog, setShowSessionLog] = useState(false)
  const [sessionLogBlocked, setSessionLogBlocked] = useState(false)
  const [tunnelOpen, setTunnelOpen] = useState(false)
  const tunnels = useTunnelManager(props.sessionId)
  const terminal = useTerminalAccess(props.terminalID)
  const clipboard = useClipboardActions(terminal.getTerminal, terminal.restoreFocus)
  const handleSessionLogOpenChange = useCallback((open: boolean) => {
    if (!open && sessionLogBlocked) return
    setShowSessionLog(open)
  }, [sessionLogBlocked])
  return <div className="relative flex h-8 flex-shrink-0 items-center gap-1 bg-muted/30 px-2">
    <span className="text-xs text-muted-foreground truncate mr-2">{props.hostname ?? 'Terminal'}</span>
    {props.serialControls ? <SerialSignalToolbar terminalID={props.terminalID} /> : null}
    <ToolbarActions {...props} onOpenSystem={props.onOpenSystem ?? (() => {})} onOpenHistory={props.onOpenHistory ?? (() => {})} onOpenAI={props.onOpenAI ?? (() => {})} onOpenTunnels={() => { setTunnelOpen(true); void tunnels.load() }} clipboard={clipboard} logOpen={showSessionLog} setLogOpen={setShowSessionLog}
      setLogBlocked={setSessionLogBlocked} onLogOpenChange={handleSessionLogOpenChange} />
    <TunnelDialog open={tunnelOpen} onOpenChange={setTunnelOpen} tunnels={tunnels.tunnels}
      onStart={tunnels.start} onStop={tunnels.stop} onDelete={tunnels.remove} sessionId={String(props.sessionId)} />
  </div>
}
