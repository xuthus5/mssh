import { TerminalEmulator } from '@/components/terminal/TerminalEmulator'

export function TerminalTab({ terminalID }: { terminalID: string }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 h-8 px-2 bg-muted/30 border-b">
        {/* Toolbar placeholder — buttons will be wired in later phases */}
      </div>
      <div className="flex-1">
        <TerminalEmulator terminalID={terminalID} />
      </div>
    </div>
  )
}
