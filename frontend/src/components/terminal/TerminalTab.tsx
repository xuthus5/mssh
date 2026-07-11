import { useState, useCallback, useEffect } from 'react'
import { TerminalEmulator } from '@/components/terminal/TerminalEmulator'
import { TerminalSplit } from '@/components/terminal/TerminalSplit'
import { TerminalToolbar } from '@/components/terminal/TerminalToolbar'
import { useAppStore } from '@/store/appStore'
import { LogService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'

export function TerminalTab({
  terminalID,
  sessionId,
  onOpenFiles,
  active,
}: {
  terminalID: string
  sessionId: number
  onOpenFiles: () => void
  active: boolean
}) {
  const [split, setSplit] = useState(false)
  const tabs = useAppStore((s) => s.tabs)
  const currentTab = tabs.find((tab) => tab.terminalId === terminalID || tab.id === terminalID)
  const recordingState = useAppStore((s) => s.recordingState[terminalID] ?? 'idle')
  const setRecordingState = useAppStore((s) => s.setRecordingState)
  const isRecording = recordingState === 'recording' || recordingState === 'stopping'

  useEffect(() => {
    if (active) useAppStore.getState().setActivePane(terminalID)
  }, [active, terminalID])

  const handleToggleRecording = useCallback(async () => {
    if (!isRecording) {
      setRecordingState(terminalID, 'starting')
      const terminalEntry = useAppStore.getState().terminalPool.get(terminalID)
      const cols = terminalEntry?.terminal.cols ?? 80
      const rows = terminalEntry?.terminal.rows ?? 24
      try {
        await LogService.StartTerminalRecording(terminalID, sessionId, cols, rows, 'xterm-256color')
        setRecordingState(terminalID, 'recording')
      } catch (err) {
        logger.error('TerminalTab: start recording failed:', err)
        setRecordingState(terminalID, 'error')
        toast(`开始录制失败: ${err instanceof Error ? err.message : String(err)}`, 'error')
      }
    } else {
      setRecordingState(terminalID, 'stopping')
      try {
        await LogService.StopTerminalRecording(terminalID)
        setRecordingState(terminalID, 'idle')
      } catch (err) {
        logger.error('TerminalTab: stop recording failed:', err)
        setRecordingState(terminalID, 'recording')
        toast(`停止录制失败: ${err instanceof Error ? err.message : String(err)}`, 'error')
      }
    }
  }, [isRecording, terminalID, sessionId, setRecordingState])

  const handleToggleSplit = useCallback(() => {
    setSplit((prev) => !prev)
  }, [])

  return (
    <div className="flex flex-col h-full">
      <TerminalToolbar
        terminalID={terminalID}
        sessionId={sessionId}
        isRecording={isRecording}
        recordingLogId={null}
        onToggleRecording={handleToggleRecording}
        hostname={currentTab?.title}
        onOpenFiles={onOpenFiles}
        onToggleSplit={handleToggleSplit}
        split={split}
      />
      <div className="flex-1">
        {split && currentTab?.sessionId ? (
          <TerminalSplit primaryID={terminalID} sessionId={currentTab.sessionId} active={active} />
        ) : (
          <TerminalEmulator terminalID={terminalID} active={active} />
        )}
      </div>
    </div>
  )
}
