import { useCallback, useRef, useState } from 'react'
import { TerminalSplit, type TerminalSplitHandle } from '@/components/terminal/TerminalSplit'
import { TerminalToolbar } from '@/components/terminal/TerminalToolbar'
import { useAppStore, type TerminalTab as TerminalTabState } from '@/store/appStore'
import { LogService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import type { TerminalFocusRequest } from '@/hooks/useTerminal'
import { CommandHistoryPanel } from '@/components/terminal/CommandHistoryPanel'
import { SystemPanel } from '@/components/terminal/SystemPanel'
import { TerminalSearchBar } from '@/components/terminal/TerminalSearchBar'
import { TerminalComposePanel } from '@/components/terminal/TerminalComposePanel'

interface Props {
  terminalID: string
  sessionId: number
  onOpenFiles: (terminalID: string) => void
  active: boolean
  focusRequest: TerminalFocusRequest
  onPaneClosed?: (terminalID: string) => void
  onPaneReplaced?: (previousID: string, nextID: string) => void
  onCloseTerminal?: () => void
}

function useRecordingControl(terminalID: string, sessionId: number) {
  const recordingState = useAppStore((state) => state.recordingState[terminalID] ?? 'idle')
  const setRecordingState = useAppStore((state) => state.setRecordingState)
  const isRecording = recordingState === 'recording' || recordingState === 'stopping'
  const toggle = useCallback(async () => {
    if (isRecording) {
      setRecordingState(terminalID, 'stopping')
      try {
        await LogService.StopTerminalRecording(terminalID)
        setRecordingState(terminalID, 'idle')
      } catch (error: unknown) {
        logger.error('TerminalTab: stop recording failed:', error)
        setRecordingState(terminalID, 'error')
        toast(`停止录制失败: ${error instanceof Error ? error.message : String(error)}`, 'error')
      }
      return
    }
    setRecordingState(terminalID, 'starting')
    const terminal = useAppStore.getState().terminalPool.get(terminalID)?.terminal
    try {
      await LogService.StartTerminalRecording(terminalID, sessionId, terminal?.cols ?? 80, terminal?.rows ?? 24, 'xterm-256color')
      setRecordingState(terminalID, 'recording')
    } catch (error: unknown) {
      logger.error('TerminalTab: start recording failed:', error)
      setRecordingState(terminalID, 'error')
      toast(`开始录制失败: ${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }, [isRecording, sessionId, setRecordingState, terminalID])
  return { isRecording, toggle }
}

export function TerminalTab({ terminalID, sessionId, onOpenFiles, active, focusRequest, onPaneClosed, onPaneReplaced, onCloseTerminal }: Props) {
  const tabs = useAppStore((state) => state.tabs)
  const activePaneID = useAppStore((state) => state.activePaneId)
  const updateTerminalWorkspace = useAppStore((state) => state.updateTerminalWorkspace)
  const currentTab = tabs.find((tab): tab is TerminalTabState => tab.type === 'terminal' && tab.terminalId === terminalID)
  const toolPanel = currentTab?.toolPanel ?? null
  const splitRef = useRef<TerminalSplitHandle>(null)
  const [splitState, setSplitState] = useState({ paneCount: 1, busy: false })
  const [searchOpen, setSearchOpen] = useState(false)
  const [composeOpen, setComposeOpen] = useState(false)
  const activeTerminalID = activePaneID ?? terminalID
  const updateWorkspace = (updates: Parameters<typeof updateTerminalWorkspace>[1]) => {
    if (currentTab) updateTerminalWorkspace(currentTab.id, updates)
  }
  const recording = useRecordingControl(activeTerminalID, sessionId)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TerminalToolbar
        terminalID={activeTerminalID}
        sessionId={sessionId}
        isRecording={recording.isRecording}
        recordingLogId={null}
        onToggleRecording={recording.toggle}
        hostname={currentTab?.title}
        onOpenFiles={() => onOpenFiles(activeTerminalID)}
        onSplit={(direction) => splitRef.current?.split(direction)}
        splitDisabled={splitState.busy || splitState.paneCount >= 8}
        paneCount={splitState.paneCount}
        searchOpen={searchOpen}
        onToggleSearch={() => setSearchOpen((value) => !value)}
        composeOpen={composeOpen}
        onToggleCompose={() => setComposeOpen((value) => !value)}
        onOpenHistory={() => updateWorkspace({ toolPanel: toolPanel === 'history' ? null : 'history' })}
        onOpenSystem={() => updateWorkspace({ toolPanel: toolPanel === 'system' ? null : 'system' })}
      />
      <div className="relative min-h-0 flex-1">
        {currentTab ? <TerminalSplit ref={splitRef} tabID={currentTab.id} primaryID={terminalID} sessionId={sessionId}
          active={active} focusRequest={focusRequest} onStateChange={setSplitState}
          onPaneClosed={onPaneClosed} onPaneReplaced={onPaneReplaced} onCloseTerminal={onCloseTerminal} /> : null}
        <TerminalSearchBar terminalID={activeTerminalID} open={searchOpen} onOpenChange={setSearchOpen} />
        {toolPanel === 'history' && <CommandHistoryPanel sessionID={sessionId} onClose={() => updateWorkspace({ toolPanel: null })} onFill={(command) => { const terminal = useAppStore.getState().terminalPool.get(activeTerminalID)?.terminal; terminal?.paste(command); terminal?.focus() }} />}
        {toolPanel === 'system' && <SystemPanel terminalID={activeTerminalID} onClose={() => updateWorkspace({ toolPanel: null })} />}
      </div>
      <TerminalComposePanel open={composeOpen} terminalID={activeTerminalID} sessionID={sessionId} onClose={() => setComposeOpen(false)} />
    </div>
  )
}
