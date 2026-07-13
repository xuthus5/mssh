import { useRef } from 'react'
import { useTerminal, type TerminalFocusRequest } from '@/hooks/useTerminal'
import '@xterm/xterm/css/xterm.css'

interface Props {
  terminalID: string
  className?: string
  active: boolean
  focusRequest: TerminalFocusRequest
}

export function TerminalEmulator({ terminalID, className, active, focusRequest }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  useTerminal(terminalID, containerRef, { active, focusRequest })

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}
    />
  )
}
