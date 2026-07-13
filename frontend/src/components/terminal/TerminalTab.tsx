import { useState, useCallback } from 'react'
import { TerminalEmulator } from '@/components/terminal/TerminalEmulator'
import { TerminalSplit } from '@/components/terminal/TerminalSplit'
import { TerminalToolbar } from '@/components/terminal/TerminalToolbar'
import { useAppStore } from '@/store/appStore'
import { LogService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import type { TerminalFocusRequest } from '@/hooks/useTerminal'

const noFocusRequest: TerminalFocusRequest = { sequence: 0, targetTerminalID: null }

interface Props {
  terminalID: string
  sessionId: number
  onOpenFiles: () => void
  active: boolean
  focusRequest: TerminalFocusRequest
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
        setRecordingState(terminalID, 'recording')
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

function TerminalViewport({ split, sessionId, terminalID, active, focusRequest }: {
  split: boolean
  sessionId?: number
  terminalID: string
  active: boolean
  focusRequest: TerminalFocusRequest
}) {
  if (split && sessionId) {
    return <TerminalSplit primaryID={terminalID} sessionId={sessionId} active={active} focusRequest={focusRequest} />
  }
  const primaryFocusRequest = focusRequest.targetTerminalID === terminalID ? focusRequest : noFocusRequest
  return <TerminalEmulator terminalID={terminalID} active={active} focusRequest={primaryFocusRequest} />
}

export function TerminalTab({ terminalID, sessionId, onOpenFiles, active, focusRequest }: Props) {
  const [split, setSplit] = useState(false)
  const tabs = useAppStore((state) => state.tabs)
  const currentTab = tabs.find((tab) => tab.terminalId === terminalID || tab.id === terminalID)
  const recording = useRecordingControl(terminalID, sessionId)

  return (
    <div className="flex flex-col h-full">
      <TerminalToolbar
        terminalID={terminalID}
        sessionId={sessionId}
        isRecording={recording.isRecording}
        recordingLogId={null}
        onToggleRecording={recording.toggle}
        hostname={currentTab?.title}
        onOpenFiles={onOpenFiles}
        onToggleSplit={() => setSplit((current) => !current)}
        split={split}
      />
      <div className="flex-1">
        <TerminalViewport split={split} sessionId={currentTab?.sessionId} terminalID={terminalID} active={active} focusRequest={focusRequest} />
      </div>
    </div>
  )
}
