import { useRef } from 'react'
import { useTerminal } from '@/hooks/useTerminal'
import '@xterm/xterm/css/xterm.css'

interface Props {
  terminalID: string
  className?: string
}

export function TerminalEmulator({ terminalID, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  useTerminal(terminalID, containerRef)

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
