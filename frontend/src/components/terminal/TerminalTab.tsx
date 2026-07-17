import { useState, useCallback } from 'react'
import { RefreshCw, WifiOff } from 'lucide-react'
import { TerminalEmulator } from '@/components/terminal/TerminalEmulator'
import { TerminalSplit } from '@/components/terminal/TerminalSplit'
import { TerminalToolbar } from '@/components/terminal/TerminalToolbar'
import { useAppStore } from '@/store/appStore'
import { LogService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import type { TerminalFocusRequest } from '@/hooks/useTerminal'
import { Button } from '@/components/ui/button'
import { CommandHistoryPanel } from '@/components/terminal/CommandHistoryPanel'

const noFocusRequest: TerminalFocusRequest = { sequence: 0, targetTerminalID: null }

interface Props {
  terminalID: string
  sessionId: number
  onOpenFiles: () => void
  active: boolean
  focusRequest: TerminalFocusRequest
  onReconnect?: () => void
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

function ConnectionOverlay({ status, onReconnect }: {
  status: import('@/store/appStore').ConnectionStatus | undefined
  onReconnect?: () => void
}) {
  if (status === 'connected' || status === undefined) return null
  const connecting = status === 'connecting' || status === 'reconnecting'
  return <div className="absolute inset-0 z-10 grid place-items-center bg-background/70 p-6 backdrop-blur-[1px]">
    <div className="flex max-w-sm flex-col items-center rounded-xl border border-border bg-card/95 p-5 text-center shadow-lg">
      {connecting
        ? <RefreshCw aria-hidden="true" className="mb-3 size-8 animate-spin text-primary" />
        : <WifiOff aria-hidden="true" className="mb-3 size-8 text-destructive" />}
      <h3 className="text-sm font-semibold text-foreground">{connecting ? '正在重新连接' : '连接已断开'}</h3>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        {connecting ? '正在为当前标签创建新的 SSH 通道。' : '远端会话可能因空闲超时或网络中断而结束，可在当前标签中重新连接。'}
      </p>
      <Button type="button" size="sm" className="mt-4" onClick={onReconnect}>
        <RefreshCw aria-hidden="true" />
        {connecting ? '取消重连' : '重新连接'}
      </Button>
    </div>
  </div>
}

export function TerminalTab({ terminalID, sessionId, onOpenFiles, active, focusRequest, onReconnect }: Props) {
  const [split, setSplit] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const tabs = useAppStore((state) => state.tabs)
  const currentTab = tabs.find((tab) => tab.type === 'terminal' && tab.terminalId === terminalID)
  const recording = useRecordingControl(terminalID, sessionId)
  const connectionStatus = useAppStore((state) => state.connectionStatus[terminalID])

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
        onOpenHistory={() => setHistoryOpen(true)}
      />
      <div className="relative min-h-0 flex-1">
        <TerminalViewport split={split} sessionId={sessionId} terminalID={terminalID} active={active} focusRequest={focusRequest} />
        <ConnectionOverlay status={connectionStatus} onReconnect={onReconnect} />
        {historyOpen && <CommandHistoryPanel sessionID={sessionId} onClose={() => setHistoryOpen(false)} onFill={(command) => { const terminal = useAppStore.getState().terminalPool.get(terminalID)?.terminal; terminal?.paste(command); terminal?.focus() }} />}
      </div>
    </div>
  )
}
