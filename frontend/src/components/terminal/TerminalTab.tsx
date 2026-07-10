import { useState, useCallback } from 'react'
import { TerminalEmulator } from '@/components/terminal/TerminalEmulator'
import { TerminalToolbar } from '@/components/terminal/TerminalToolbar'
import { useAppStore } from '@/store/appStore'

export function TerminalTab({
  terminalID,
  onOpenFiles,
}: {
  terminalID: string
  onOpenFiles: () => void
}) {
  const [isRecording, setIsRecording] = useState(false)
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const activeTab = tabs.find((t) => t.id === activeTabId)

  const handleToggleRecording = useCallback(() => {
    setIsRecording((prev) => {
      const next = !prev
      console.log('[TerminalTab] recording:', next ? 'started' : 'stopped')
      return next
    })
  }, [])

  return (
    <div className="flex flex-col h-full">
      <TerminalToolbar
        terminalID={terminalID}
        isRecording={isRecording}
        onToggleRecording={handleToggleRecording}
        hostname={activeTab?.title}
        onOpenFiles={onOpenFiles}
      />
      <div className="flex-1">
        <TerminalEmulator terminalID={terminalID} />
      </div>
    </div>
  )
}
