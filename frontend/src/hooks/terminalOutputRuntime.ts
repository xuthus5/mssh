import type { RefObject } from 'react'
import type { Terminal } from '@xterm/xterm'
import { Events } from '@wailsio/runtime'
import type { TerminalRuntimeErrorReporter } from '@/components/terminal/TerminalErrorBoundary'
import { TerminalOutputSequencer } from '@/components/terminal/terminalOutputSequencer'
import { TerminalOutputFlowControl } from '@/components/terminal/terminalOutputFlowControl'
import { runTerminalRuntime } from '@/components/terminal/terminalRuntime'
import { SynchronizedOutputWriter } from '@/components/terminal/terminalSynchronizedOutput'
import { TerminalOutputCoalescer } from '@/components/terminal/terminalOutputCoalescer'
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

export interface TerminalOutputSubscription {
  dispose: () => void
  /** Flush synchronized buffer + coalescer so inactive batches become visible immediately. */
  flush: () => void
}

type SetOutputPaused = (terminalID: string, paused: boolean) => Promise<void>

interface OutputPauseRequest {
  terminalID: string
  paused: boolean
}

const resumeRetryCount = 2

function sameOutputPauseRequest(left: OutputPauseRequest | null, right: OutputPauseRequest): boolean {
  return left?.terminalID === right.terminalID && left.paused === right.paused
}

async function retryOutputResume(setOutputPaused: SetOutputPaused, request: OutputPauseRequest, error: unknown) {
  let lastError = error
  for (let attempt = 0; attempt < resumeRetryCount; attempt++) {
    try {
      await setOutputPaused(request.terminalID, false)
      return true
    } catch (retryError: unknown) {
      lastError = retryError
    }
  }
  logger.warn('terminal output resume failed; flow control disabled', { terminalID: request.terminalID, error: lastError })
  return false
}

async function releaseOutputPauseAfterFailure(setOutputPaused: SetOutputPaused, request: OutputPauseRequest, error: unknown) {
  logger.warn('terminal output flow control unavailable', { terminalID: request.terminalID, paused: request.paused, error })
  if (!request.paused) return retryOutputResume(setOutputPaused, request, error)
  try {
    await setOutputPaused(request.terminalID, false)
    return true
  } catch (releaseError: unknown) {
    logger.warn('terminal output resume failed; flow control disabled', { terminalID: request.terminalID, error: releaseError })
    return false
  }
}

export function createOutputPauseRequester(
  terminalIDRef: RefObject<string | null>,
  setOutputPaused: SetOutputPaused,
  onUnavailable?: () => void,
) {
  let pausedTerminalID: string | null = null
  let desired: OutputPauseRequest | null = null
  let applied: OutputPauseRequest | null = null
  let running = false
  let pauseUnavailable = false

  const pump = async () => {
    if (running || !desired || (pauseUnavailable && desired.paused)) return
    const request = desired
    if (sameOutputPauseRequest(applied, request)) {
      desired = null
      return
    }
    running = true
    try {
      await setOutputPaused(request.terminalID, request.paused)
      applied = request
    } catch (error: unknown) {
      desired = null
      const recovered = await releaseOutputPauseAfterFailure(setOutputPaused, request, error)
      if (recovered) {
        applied = { terminalID: request.terminalID, paused: false }
      }
      pauseUnavailable = request.paused || !recovered
      if (pauseUnavailable) onUnavailable?.()
    } finally {
      running = false
      if (desired && sameOutputPauseRequest(applied, desired)) desired = null
      if (desired && (!pauseUnavailable || !desired.paused)) void pump()
    }
  }

  return (paused: boolean) => {
    const targetID = paused ? terminalIDRef.current : pausedTerminalID ?? terminalIDRef.current
    if (!targetID) return
    if (paused) pausedTerminalID = targetID
    else pausedTerminalID = null
    desired = { terminalID: targetID, paused }
    void pump()
  }
}

function createOutputFlowControl({ term, terminalIDRef, reportRuntimeError, setOutputPaused }: {
  term: Terminal
  terminalIDRef: RefObject<string | null>
  reportRuntimeError: TerminalRuntimeErrorReporter
  setOutputPaused: SetOutputPaused
}) {
  let flowControl: TerminalOutputFlowControl | null = null
  let unavailableReported = false
  const requestPause = createOutputPauseRequester(terminalIDRef, setOutputPaused, () => {
    flowControl?.disableFlowControl()
    if (unavailableReported) return
    unavailableReported = true
    reportRuntimeError(new Error('terminal output flow control unavailable'), 'terminal output flow control')
  })
  flowControl = new TerminalOutputFlowControl({
    write: (data, onParsed) => runTerminalRuntime(reportRuntimeError, 'terminal output write', () => term.write(data, onParsed)),
    pause: () => requestPause(true),
    resume: () => requestPause(false),
    onWriteFailure: () => logger.warn('terminal output flow stopped after write failure'),
  })
  return flowControl
}

function createTerminalOutputEventHandler({ terminalIDRef, reportRuntimeError, output, flowControl, flush, outputTransform }: {
  terminalIDRef: RefObject<string | null>
  reportRuntimeError: TerminalRuntimeErrorReporter
  output: SynchronizedOutputWriter
  flowControl: TerminalOutputFlowControl | null
  flush: () => void
  outputTransform: (data: Uint8Array) => Uint8Array
}) {
  let outputTerminalID = terminalIDRef.current
  let sequencer = new TerminalOutputSequencer((data) => output.push(data))
  return (event: { data?: TerminalOutputEvent }) => {
    const payload = event.data
    const encodedData = payload?.data
    const terminalID = terminalIDRef.current
    const payloadTerminalID = payload?.terminal_id
    if (!terminalID || payloadTerminalID !== terminalID || !encodedData) return
    if (outputTerminalID !== payloadTerminalID) {
      flowControl?.resume()
      flush()
      outputTerminalID = payloadTerminalID
      sequencer = new TerminalOutputSequencer((data) => output.push(data))
    }
    runTerminalRuntime(reportRuntimeError, 'terminal output decode', () => {
      const decoded = decodeTerminalOutput(encodedData)
      const transformed = outputTransform(decoded)
      if (payload.sequence === undefined) {
        output.push(transformed)
        return
      }
      try {
        sequencer.push(payload.sequence, transformed)
      } catch (error: unknown) {
        logger.warn('terminal output sequence gap exceeded; resynchronizing', {
          terminalID,
          sequence: payload.sequence,
          error,
        })
        if (!Number.isSafeInteger(payload.sequence) || payload.sequence < 1) throw error
        sequencer.reset(payload.sequence)
        sequencer.push(payload.sequence, decoded)
      }
    })
  }
}

export function subscribeToTerminalOutput({ term, terminalIDRef, reportRuntimeError, shouldCoalesce, setOutputPaused, outputTransform, outputFlush }: {
  term: Terminal
  terminalIDRef: RefObject<string | null>
  reportRuntimeError: TerminalRuntimeErrorReporter
  /** When true, batch writes to reduce inactive-tab write storms (still keeps buffer in sync). */
  shouldCoalesce?: () => boolean
  setOutputPaused?: SetOutputPaused
  /** Optional transform applied to each decoded chunk before writing (e.g. keyword highlighting). */
  outputTransform?: (data: Uint8Array) => Uint8Array
  /** Returns any buffered transform output that must be flushed before the terminal buffer settles. */
  outputFlush?: () => Uint8Array | undefined
}): TerminalOutputSubscription {
  const transform = outputTransform ?? ((data: Uint8Array) => data)
  const flowControl = setOutputPaused ? createOutputFlowControl({ term, terminalIDRef, reportRuntimeError, setOutputPaused }) : null
  const coalescer = new TerminalOutputCoalescer((data) => {
    if (flowControl) {
      flowControl.push(data)
      return
    }
    runTerminalRuntime(reportRuntimeError, 'terminal output write', () => term.write(data))
  }, {
    shouldCoalesce: shouldCoalesce ?? (() => false),
  })
  const output = new SynchronizedOutputWriter((data) => {
    const bytes = typeof data === 'string'
      ? Uint8Array.from(data, (character) => character.charCodeAt(0))
      : data
    coalescer.push(bytes)
  }, {
    onDiagnostics: (diagnostics) => logger.info('terminal synchronized output diagnostics', {
      terminalID: terminalIDRef.current,
      ...diagnostics,
    }),
  })
  const flush = createTerminalOutputFlush({ output, coalescer, flowControl, outputFlush })
  const handleOutput = createTerminalOutputEventHandler({ terminalIDRef, reportRuntimeError, output, flowControl, flush, outputTransform: transform })
  const unsubscribe = Events.On('terminal:output', handleOutput)
  return {
    dispose: () => {
      unsubscribe()
      output.dispose()
      coalescer.dispose()
      flowControl?.dispose()
    },
    flush,
  }
}

function createTerminalOutputFlush({ output, coalescer, flowControl, outputFlush }: {
  output: SynchronizedOutputWriter
  coalescer: TerminalOutputCoalescer
  flowControl: TerminalOutputFlowControl | null
  outputFlush?: () => Uint8Array | undefined
}): () => void {
  return () => {
    const extras = outputFlush?.()
    if (extras && extras.length > 0) output.push(extras)
    output.flush()
    coalescer.flush()
    flowControl?.flush()
  }
}
