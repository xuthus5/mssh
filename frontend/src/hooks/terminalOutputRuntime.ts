import type { RefObject } from 'react'
import type { Terminal } from '@xterm/xterm'
import { Events } from '@wailsio/runtime'
import type { TerminalRuntimeErrorReporter } from '@/components/terminal/TerminalErrorBoundary'
import { runTerminalRuntime } from '@/components/terminal/terminalRuntime'
import { SynchronizedOutputWriter } from '@/components/terminal/terminalSynchronizedOutput'

interface TerminalOutputEvent {
  terminal_id?: string
  data?: string
}

export function decodeTerminalOutput(data: string): Uint8Array {
  const binary = atob(data)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export function subscribeToSynchronizedOutputQuery(term: Terminal) {
  return term.parser.registerCsiHandler({ prefix: '?', intermediates: '$', final: 'p' }, (params) => {
    if (params[0] !== 2026) return false
    term.input('\u001b[?2026;2$y', false)
    return true
  })
}

export function subscribeToTerminalOutput({ term, terminalIDRef, reportRuntimeError }: {
  term: Terminal
  terminalIDRef: RefObject<string>
  reportRuntimeError: TerminalRuntimeErrorReporter
}) {
  let outputTerminalID = terminalIDRef.current
  const output = new SynchronizedOutputWriter((data) => {
    runTerminalRuntime(reportRuntimeError, 'terminal output write', () => term.write(data))
  })
  const unsubscribe = Events.On('terminal:output', (event: { data?: TerminalOutputEvent }) => {
    const payload = event.data
    const encodedData = payload?.data
    if (payload?.terminal_id !== terminalIDRef.current || !encodedData) return
    if (outputTerminalID !== payload.terminal_id) {
      output.flush()
      outputTerminalID = payload.terminal_id
    }
    runTerminalRuntime(reportRuntimeError, 'terminal output decode', () => output.push(decodeTerminalOutput(encodedData)))
  })
  return () => {
    unsubscribe()
    output.dispose()
  }
}
