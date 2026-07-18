import type { RefObject } from 'react'
import type { Terminal } from '@xterm/xterm'
import { Events } from '@wailsio/runtime'
import type { TerminalRuntimeErrorReporter } from '@/components/terminal/TerminalErrorBoundary'
import { TerminalOutputSequencer } from '@/components/terminal/terminalOutputSequencer'
import { runTerminalRuntime } from '@/components/terminal/terminalRuntime'
import { SynchronizedOutputWriter } from '@/components/terminal/terminalSynchronizedOutput'
import { logger } from '@/lib/logger'

interface TerminalOutputEvent {
  terminal_id?: string
  sequence?: number
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

// tmux 仅在能识别外层终端型号时才对其启用 synchronized output（DECSET 2026），
// 识别途径是 XTVERSION（CSI > q）应答与其内建特性表。xterm.js 不应答该查询，
// tmux 会退化为无同步的整屏重绘，导致 tmux 内运行 TUI（如 claude）时整页闪烁。
// 这里以 foot 身份应答：tmux 特性表中 foot 是唯一含 sync 且不含 margins
// （DECSLRM，xterm.js 不支持）的档案，与 xterm.js 实际能力一致。
const terminalVersionReply = '\u001bP>|foot(1.16.2)\u001b\\'

export function subscribeToTerminalVersionQuery(term: Terminal) {
  return term.parser.registerCsiHandler({ prefix: '>', final: 'q' }, (params) => {
    if (params.length > 1 || params[0] !== 0) return false
    term.input(terminalVersionReply, false)
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
  }, {
    onDiagnostics: (diagnostics) => logger.info('terminal synchronized output diagnostics', {
      terminalID: terminalIDRef.current,
      ...diagnostics,
    }),
  })
  let sequencer = new TerminalOutputSequencer((data) => output.push(data))
  const unsubscribe = Events.On('terminal:output', (event: { data?: TerminalOutputEvent }) => {
    const payload = event.data
    const encodedData = payload?.data
    if (payload?.terminal_id !== terminalIDRef.current || !encodedData) return
    if (outputTerminalID !== payload.terminal_id) {
      output.flush()
      outputTerminalID = payload.terminal_id
      sequencer = new TerminalOutputSequencer((data) => output.push(data))
    }
    runTerminalRuntime(reportRuntimeError, 'terminal output decode', () => {
      const decoded = decodeTerminalOutput(encodedData)
      if (payload.sequence === undefined) {
        output.push(decoded)
        return
      }
      sequencer.push(payload.sequence, decoded)
    })
  })
  return () => {
    unsubscribe()
    output.dispose()
  }
}
