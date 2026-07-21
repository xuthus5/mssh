export interface TerminalOutputCoalescerOptions {
  /** Max delay before a pending batch is flushed. */
  maxDelayMs?: number
  /** Flush immediately once buffered bytes reach this threshold. */
  maxBytes?: number
  /** When false, chunks pass through immediately (no batching). */
  shouldCoalesce?: () => boolean
  schedule?: (callback: () => void, delayMs: number) => number
  cancel?: (handle: number) => void
}

const defaultMaxDelayMs = 32
const defaultMaxBytes = 64 * 1024

/** Bounded output batching to reduce main-thread write storms for hot streams. */
export interface TerminalOutputCoalescerMetrics {
  pushedChunks: number
  pushedBytes: number
  flushedBatches: number
  flushedBytes: number
  passThroughChunks: number
  passThroughBytes: number
}

export class TerminalOutputCoalescer {
  private pending: Uint8Array[] = []
  private pendingBytes = 0
  private timer: number | null = null
  private readonly maxDelayMs: number
  private readonly maxBytes: number
  private readonly shouldCoalesce: () => boolean
  private readonly schedule: (callback: () => void, delayMs: number) => number
  private readonly cancel: (handle: number) => void
  private metrics: TerminalOutputCoalescerMetrics = {
    pushedChunks: 0,
    pushedBytes: 0,
    flushedBatches: 0,
    flushedBytes: 0,
    passThroughChunks: 0,
    passThroughBytes: 0,
  }

  constructor(
    private readonly write: (data: Uint8Array) => void,
    options: TerminalOutputCoalescerOptions = {},
  ) {
    this.maxDelayMs = options.maxDelayMs ?? defaultMaxDelayMs
    this.maxBytes = options.maxBytes ?? defaultMaxBytes
    this.shouldCoalesce = options.shouldCoalesce ?? (() => true)
    this.schedule = options.schedule ?? ((callback, delayMs) => window.setTimeout(callback, delayMs))
    this.cancel = options.cancel ?? ((handle) => window.clearTimeout(handle))
  }

  push(data: Uint8Array): void {
    if (data.length === 0) return
    this.metrics.pushedChunks += 1
    this.metrics.pushedBytes += data.length
    if (!this.shouldCoalesce()) {
      this.flush()
      this.metrics.passThroughChunks += 1
      this.metrics.passThroughBytes += data.length
      this.write(data)
      return
    }
    this.pending.push(data)
    this.pendingBytes += data.length
    if (this.pendingBytes >= this.maxBytes) {
      this.flush()
      return
    }
    if (this.timer === null) {
      this.timer = this.schedule(() => {
        this.timer = null
        this.flush()
      }, this.maxDelayMs)
    }
  }

  flush(): void {
    if (this.timer !== null) {
      this.cancel(this.timer)
      this.timer = null
    }
    if (this.pending.length === 0) return
    const merged = mergeChunks(this.pending, this.pendingBytes)
    this.pending = []
    this.pendingBytes = 0
    this.metrics.flushedBatches += 1
    this.metrics.flushedBytes += merged.length
    this.write(merged)
  }

  getMetrics(): TerminalOutputCoalescerMetrics {
    return { ...this.metrics }
  }

  dispose(): void {
    this.flush()
  }
}

function mergeChunks(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  if (chunks.length === 1) return chunks[0]
  const merged = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return merged
}
