import { useState, useCallback } from 'react'
import { TerminalEmulator } from '@/components/terminal/TerminalEmulator'
import { TerminalSplit } from '@/components/terminal/TerminalSplit'
import { TerminalToolbar } from '@/components/terminal/TerminalToolbar'
import { useAppStore } from '@/store/appStore'
import { LogService } from '@/lib/wails'

export function TerminalTab({
  terminalID,
  sessionId,
  onOpenFiles,
}: {
  terminalID: string
  sessionId: number
  onOpenFiles: () => void
}) {
  const [isRecording, setIsRecording] = useState(false)
  const [recordingLogId, setRecordingLogId] = useState<number | null>(null)
  const [split, setSplit] = useState(false)
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const activeTab = tabs.find((t) => t.id === activeTabId)

  const handleToggleRecording = useCallback(async () => {
    if (!isRecording) {
      const terminalEntry = useAppStore.getState().terminalPool.get(terminalID)
      const cols = terminalEntry?.terminal.cols ?? 80
      const rows = terminalEntry?.terminal.rows ?? 24
      try {
        const logId = await LogService.StartTerminalRecording(terminalID, sessionId, cols, rows, 'xterm-256color')
        setRecordingLogId(logId)
        setIsRecording(true)
      } catch (err) {
        console.error('[TerminalTab] start recording failed:', err)
      }
    } else {
      try {
        await LogService.StopTerminalRecording(terminalID)
      } catch (err) {
        console.error('[TerminalTab] stop recording failed:', err)
      }
      setIsRecording(false)
      setRecordingLogId(null)
    }
  }, [isRecording, terminalID, sessionId])

  const handleToggleSplit = useCallback(() => {
    setSplit((prev) => !prev)
  }, [])

  return (
    <div className="flex flex-col h-full">
      <TerminalToolbar
        terminalID={terminalID}
        sessionId={sessionId}
        isRecording={isRecording}
        recordingLogId={recordingLogId}
        onToggleRecording={handleToggleRecording}
        hostname={activeTab?.title}
        onOpenFiles={onOpenFiles}
        onToggleSplit={handleToggleSplit}
        split={split}
      />
      <div className="flex-1">
        {split && activeTab?.sessionId ? (
          <TerminalSplit primaryID={terminalID} sessionId={activeTab.sessionId} />
        ) : (
          <TerminalEmulator terminalID={terminalID} />
        )}
      </div>
    </div>
  )
}
