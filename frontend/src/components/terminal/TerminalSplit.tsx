import { useState, useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { X, Columns2, Rows2 } from 'lucide-react'
import { TerminalEmulator } from '@/components/terminal/TerminalEmulator'
import { TerminalService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { useAppStore } from '@/store/appStore'
import type { TerminalFocusRequest } from '@/hooks/useTerminal'
import { toast } from '@/components/ui/toast'

const noFocusRequest: TerminalFocusRequest = { sequence: 0, targetTerminalID: null }

interface Props {
  primaryID: string
  sessionId: number
  active: boolean
  focusRequest: TerminalFocusRequest
  direction?: 'horizontal' | 'vertical'
  onDirectionChange?: (direction: 'horizontal' | 'vertical') => void
}

function closeSplitTerminalInBackground(terminalID: string, context: string) {
  void TerminalService.Close(terminalID).catch((error: unknown) => logger.error(context, error))
}

async function openSplitTerminal({ sessionId, isCancelled, onOpen }: {
  sessionId: number
  isCancelled: () => boolean
  onOpen: (terminalID: string) => void
}) {
  try {
    const terminalID = await TerminalService.Open(sessionId, 80, 24)
    if (isCancelled()) {
      closeSplitTerminalInBackground(terminalID, 'TerminalSplit: failed to close cancelled split')
      return
    }
    onOpen(terminalID)
  } catch (error: unknown) {
    logger.error('TerminalSplit: failed to open split', error)
  }
}

function restorePrimaryPane(primaryID: string, closedTerminalID: string) {
  const state = useAppStore.getState()
  if (state.activePaneId !== closedTerminalID) return
  const tab = state.tabs.find((item) => item.type === 'terminal' && item.terminalId === primaryID)
  const shouldRequestFocus = tab !== undefined
    && state.activeSurface?.type === 'terminal'
    && state.activeSurface.id === tab.id
  state.setActivePane(primaryID)
  if (shouldRequestFocus) state.requestTerminalFocus(tab.id, primaryID)
}

async function closeSplitTerminal({ terminalID, primaryID, mountedRef, closingRef, splitIDRef, setSplitID, setClosing }: {
  terminalID: string
  primaryID: string
  mountedRef: RefObject<boolean>
  closingRef: RefObject<boolean>
  splitIDRef: RefObject<string | null>
  setSplitID: Dispatch<SetStateAction<string | null>>
  setClosing: Dispatch<SetStateAction<boolean>>
}) {
  try {
    await TerminalService.Close(terminalID)
  } catch (error: unknown) {
    logger.error('TerminalSplit: failed to close split', error)
    if (mountedRef.current) {
      toast(`关闭分屏失败: ${error instanceof Error ? error.message : String(error)}`, 'error')
      setClosing(false)
    } else {
      closeSplitTerminalInBackground(terminalID, 'TerminalSplit: failed to close split after unmount')
    }
    closingRef.current = false
    return
  }
  closingRef.current = false
  splitIDRef.current = null
  if (!mountedRef.current) return
  setSplitID(null)
  setClosing(false)
  restorePrimaryPane(primaryID, terminalID)
}

function useSplitTerminal(sessionId: number, primaryID: string) {
  const [splitID, setSplitID] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const splitIDRef = useRef<string | null>(null)
  const mountedRef = useRef(false)
  const closingRef = useRef(false)
  useEffect(() => {
    let cancelled = false
    mountedRef.current = true
    void openSplitTerminal({
      sessionId,
      isCancelled: () => cancelled,
      onOpen: (terminalID) => {
        splitIDRef.current = terminalID
        setSplitID(terminalID)
      },
    })

    return () => {
      cancelled = true
      mountedRef.current = false
      const terminalID = splitIDRef.current
      splitIDRef.current = null
      if (terminalID && !closingRef.current) {
        closeSplitTerminalInBackground(terminalID, 'TerminalSplit: failed to close split')
      }
    }
  }, [sessionId])
  const close = () => {
    const terminalID = splitIDRef.current
    if (!terminalID || closingRef.current) return
    closingRef.current = true
    setClosing(true)
    return closeSplitTerminal({ terminalID, primaryID, mountedRef, closingRef, splitIDRef, setSplitID, setClosing })
  }
  return { splitID, closing, close }
}

function SplitToolbar({ direction, splitOpen, closing, onDirection, onClose }: {
  direction: 'horizontal' | 'vertical'
  splitOpen: boolean
  closing: boolean
  onDirection: (direction: 'horizontal' | 'vertical') => void
  onClose: () => void
}) {
  const buttonClass = (selected: boolean) => `flex items-center gap-1 px-1.5 py-0.5 rounded text-xs transition-colors ${
    selected ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
  }`
  return <div className="flex items-center gap-1 h-8 px-2 bg-muted/30 border-b flex-shrink-0">
    <span className="text-xs text-muted-foreground">分屏</span>
    <div className="flex items-center gap-0.5 ml-auto">
      <button type="button" className={buttonClass(direction === 'horizontal')} onClick={() => onDirection('horizontal')} title="水平分屏"><Columns2 className="h-3 w-3" /></button>
      <button type="button" className={buttonClass(direction === 'vertical')} onClick={() => onDirection('vertical')} title="垂直分屏"><Rows2 className="h-3 w-3" /></button>
      {splitOpen ? <button type="button" disabled={closing} className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-muted-foreground hover:bg-muted/50 hover:text-destructive transition-colors disabled:opacity-50" onClick={onClose} title="关闭分屏"><X className="h-3 w-3" /></button> : null}
    </div>
  </div>
}

function requestForPane(focusRequest: TerminalFocusRequest, terminalID: string) {
  return focusRequest.targetTerminalID === terminalID ? focusRequest : noFocusRequest
}

function SplitPanes({ primaryID, splitID, active, activePaneID, direction, focusRequest }: Props & {
  splitID: string | null
  activePaneID: string | null
  direction: 'horizontal' | 'vertical'
}) {
  return <div className="flex-1 flex min-h-0" style={{ flexDirection: direction === 'horizontal' ? 'row' : 'column' }}>
    <div className="flex-1 min-h-0 min-w-0 border-r border-border/50">
      <TerminalEmulator terminalID={primaryID} active={active && activePaneID !== splitID} focusRequest={requestForPane(focusRequest, primaryID)} />
    </div>
    {splitID ? <div className="flex-1 min-h-0 min-w-0">
      <TerminalEmulator terminalID={splitID} active={active && activePaneID === splitID} focusRequest={requestForPane(focusRequest, splitID)} />
    </div> : null}
  </div>
}

export function TerminalSplit({ primaryID, sessionId, active, focusRequest, direction = 'horizontal', onDirectionChange = () => {} }: Props) {
  const activePaneID = useAppStore((state) => state.activePaneId)
  const split = useSplitTerminal(sessionId, primaryID)

  return (
    <div className="flex flex-col h-full">
      <SplitToolbar direction={direction} splitOpen={split.splitID !== null} closing={split.closing} onDirection={onDirectionChange} onClose={() => { void split.close() }} />
      <SplitPanes primaryID={primaryID} sessionId={sessionId} active={active} focusRequest={focusRequest}
        splitID={split.splitID} activePaneID={activePaneID} direction={direction} />
    </div>
  )
}
