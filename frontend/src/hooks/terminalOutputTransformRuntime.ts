export const TERMINAL_OUTPUT_TRANSFORM_IDLE_FLUSH_MS = 16

export interface TerminalOutputTransformRuntimeOptions {
  transform: (data: Uint8Array) => Uint8Array
  flush: () => Uint8Array | undefined
  emit: (data: Uint8Array) => void
  shouldSchedule?: () => boolean
  idleFlushMs?: number
  schedule?: (callback: () => void, delayMs: number) => number
  cancel?: (handle: number) => void
  onError?: (error: unknown) => void
}

export interface TerminalOutputTransformRuntime {
  transform: (data: Uint8Array) => Uint8Array
  flush: () => void
  dispose: () => void
}

/** Keeps stateful output transforms ordered and releases lookahead after an idle gap. */
export function createTerminalOutputTransformRuntime(options: TerminalOutputTransformRuntimeOptions): TerminalOutputTransformRuntime {
  const idleFlushMs = Math.max(0, options.idleFlushMs ?? TERMINAL_OUTPUT_TRANSFORM_IDLE_FLUSH_MS)
  const schedule = options.schedule ?? ((callback, delayMs) => window.setTimeout(callback, delayMs))
  const cancel = options.cancel ?? ((handle) => window.clearTimeout(handle))
  let timer: number | null = null
  let disposed = false

  const cancelTimer = () => {
    if (timer === null) return
    cancel(timer)
    timer = null
  }

  const emitFlush = () => {
    if (disposed) return
    try {
      const extras = options.flush()
      if (extras && extras.length > 0) options.emit(extras)
    } catch (error: unknown) {
      options.onError?.(error)
    }
  }

  const scheduleFlush = () => {
    cancelTimer()
    timer = schedule(() => {
      timer = null
      emitFlush()
    }, idleFlushMs)
  }

  return {
    transform: (data) => {
      if (disposed) return data
      const transformed = options.transform(data)
      if (options.shouldSchedule?.() ?? true) scheduleFlush()
      else cancelTimer()
      return transformed
    },
    flush: () => {
      cancelTimer()
      emitFlush()
    },
    dispose: () => {
      disposed = true
      cancelTimer()
    },
  }
}
