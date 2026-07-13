import { useState, useEffect, useRef } from 'react'
import { X, Columns2, Rows2 } from 'lucide-react'
import { TerminalEmulator } from '@/components/terminal/TerminalEmulator'
import { TerminalService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { useAppStore } from '@/store/appStore'
import type { TerminalFocusRequest } from '@/hooks/useTerminal'

const noFocusRequest: TerminalFocusRequest = { sequence: 0, targetTerminalID: null }

interface Props {
  primaryID: string
  sessionId: number
  active: boolean
  focusRequest: TerminalFocusRequest
}

function closeSplitTerminal(terminalID: string, context: string) {
  void TerminalService.Close(terminalID).catch((error: unknown) => logger.error(context, error))
}

function useSplitTerminal(sessionId: number, primaryID: string) {
  const [splitID, setSplitID] = useState<string | null>(null)
  const splitIDRef = useRef<string | null>(null)
  useEffect(() => {
    let cancelled = false
    const openSplit = async () => {
      try {
        const id = await TerminalService.Open(sessionId, 80, 24)
        if (cancelled) return
        splitIDRef.current = id
        setSplitID(id)
      } catch (err) {
        logger.error('TerminalSplit: failed to open split', err)
      }
    }
    openSplit()

    return () => {
      cancelled = true
      const terminalID = splitIDRef.current
      splitIDRef.current = null
      if (terminalID) closeSplitTerminal(terminalID, 'TerminalSplit: failed to close split')
    }
  }, [sessionId])
  const close = () => {
    const terminalID = splitIDRef.current
    if (!terminalID) return
    const state = useAppStore.getState()
    if (state.activePaneId === terminalID) state.setActivePane(primaryID)
    splitIDRef.current = null
    setSplitID(null)
    closeSplitTerminal(terminalID, 'TerminalSplit: failed to close split')
  }
  return { splitID, close }
}

function SplitToolbar({ direction, splitOpen, onDirection, onClose }: {
  direction: 'horizontal' | 'vertical'
  splitOpen: boolean
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
      {splitOpen ? <button type="button" className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-muted-foreground hover:bg-muted/50 hover:text-destructive transition-colors" onClick={onClose} title="关闭分屏"><X className="h-3 w-3" /></button> : null}
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

export function TerminalSplit({ primaryID, sessionId, active, focusRequest }: Props) {
  const [direction, setDirection] = useState<'horizontal' | 'vertical'>('horizontal')
  const activePaneID = useAppStore((state) => state.activePaneId)
  const split = useSplitTerminal(sessionId, primaryID)

  return (
    <div className="flex flex-col h-full">
      <SplitToolbar direction={direction} splitOpen={split.splitID !== null} onDirection={setDirection} onClose={split.close} />
      <SplitPanes primaryID={primaryID} sessionId={sessionId} active={active} focusRequest={focusRequest}
        splitID={split.splitID} activePaneID={activePaneID} direction={direction} />
    </div>
  )
}
