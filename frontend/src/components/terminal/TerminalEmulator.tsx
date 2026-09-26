import { useRef } from 'react'
import { TerminalInteractionSurface } from '@/components/terminal/TerminalInteractionSurface'
import { useTerminal, type TerminalFocusRequest } from '@/hooks/useTerminal'
import { useAppStore } from '@/store/appStore'
import { cn } from '@/lib/utils'
import '@xterm/xterm/css/xterm.css'

interface Props {
  terminalID: string
  className?: string
  active: boolean
  focusRequest: TerminalFocusRequest
}

export function TerminalEmulator({ terminalID, className, active, focusRequest }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // xterm's viewport background is transparent (see globals.css), so the gaps it
  // leaves at the [&>.xterm]:pl-1 strip and the row-height remainder need the
  // terminal theme background painted behind it.
  const background = useAppStore((state) => state.terminalTheme.background)
  const terminalRef = useTerminal(terminalID, containerRef, { active, focusRequest })

  return (
    <TerminalInteractionSurface terminalRef={terminalRef} terminalID={terminalID}>
      <div
        ref={containerRef}
        className={cn('mssh-terminal-surface [&>.xterm]:h-full [&>.xterm]:min-h-0 [&>.xterm]:w-full [&>.xterm]:min-w-0 [&>.xterm]:pl-1', className)}
        style={{
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          backgroundColor: background,
        }}
      />
    </TerminalInteractionSurface>
  )
}
