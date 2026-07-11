import { useRef } from 'react'
import { useTerminal } from '@/hooks/useTerminal'
import '@xterm/xterm/css/xterm.css'

interface Props {
  terminalID: string
  className?: string
  active: boolean
}

export function TerminalEmulator({ terminalID, className, active }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  useTerminal(terminalID, containerRef, active)

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
