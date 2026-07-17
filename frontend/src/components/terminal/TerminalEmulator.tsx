import { useRef } from 'react'
import { TerminalInteractionSurface } from '@/components/terminal/TerminalInteractionSurface'
import { useTerminal, type TerminalFocusRequest } from '@/hooks/useTerminal'
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
  const terminalRef = useTerminal(terminalID, containerRef, { active, focusRequest })

  return (
    <TerminalInteractionSurface terminalRef={terminalRef}>
      <div
        ref={containerRef}
        className={cn('[&>.xterm]:pl-1.5', className)}
        style={{
          width: '100%',
          height: '100%',
          overflow: 'hidden',
        }}
      />
    </TerminalInteractionSurface>
  )
}
