export interface TerminalOutputFlowControlOptions {
  write: (data: Uint8Array, onParsed: () => void) => boolean
  pause: () => void
  resume: () => void
  onWriteFailure?: () => void
  highWaterBytes?: number
  lowWaterBytes?: number
}

const defaultHighWaterBytes = 256 * 1024
const defaultLowWaterBytes = 64 * 1024

export interface TerminalOutputFlowMetrics {
  pendingBytes: number
  inFlightBytes: number
  paused: boolean
  writes: number
  completedWrites: number
}

/** Serializes xterm writes and pauses the PTY before xterm's queue grows unbounded. */
export class TerminalOutputFlowControl {
  private readonly pending: Uint8Array[] = []
  private pendingBytes = 0
  private inFlightBytes = 0
  private writing = false
  private paused = false
  private disposed = false
  private writes = 0
  private completedWrites = 0
  private flowControlUnavailable = false
  private readonly highWaterBytes: number
  private readonly lowWaterBytes: number

  constructor(private readonly options: TerminalOutputFlowControlOptions) {
    this.highWaterBytes = options.highWaterBytes ?? defaultHighWaterBytes
    this.lowWaterBytes = options.lowWaterBytes ?? defaultLowWaterBytes
    if (this.lowWaterBytes >= this.highWaterBytes) {
      throw new Error('low water mark must be below high water mark')
    }
  }

  push(data: Uint8Array): void {
    if (this.disposed || data.length === 0) return
    this.pending.push(data)
    this.pendingBytes += data.length
    this.updateFlowState()
    this.drain()
  }

  flush(): void {
    if (this.disposed) return
    this.drain()
  }

  resume(): void {
    if (!this.paused) return
    this.paused = false
    this.options.resume()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.pending.length = 0
    this.pendingBytes = 0
    this.resume()
  }

  disableFlowControl(): void {
    this.flowControlUnavailable = true
    this.paused = false
    this.drain()
  }

  getMetrics(): TerminalOutputFlowMetrics {
    return {
      pendingBytes: this.pendingBytes,
      inFlightBytes: this.inFlightBytes,
      paused: this.paused,
      writes: this.writes,
      completedWrites: this.completedWrites,
    }
  }

  private drain(): void {
    if (this.disposed || this.writing || this.pending.length === 0) return
    const data = this.pending.shift()
    if (!data) return
    this.pendingBytes -= data.length
    this.inFlightBytes += data.length
    this.writing = true
    this.writes += 1
    let parsed = false
    const onParsed = () => {
      if (parsed) return
      parsed = true
      this.writing = false
      this.inFlightBytes -= data.length
      this.completedWrites += 1
      this.updateFlowState()
      this.drain()
    }
    if (!this.options.write(data, onParsed)) {
      this.writing = false
      this.inFlightBytes -= data.length
      this.options.onWriteFailure?.()
      this.updateFlowState()
    }
  }

  private updateFlowState(): void {
    if (this.flowControlUnavailable) return
    const queuedBytes = this.pendingBytes + this.inFlightBytes
    if (!this.paused && queuedBytes >= this.highWaterBytes) {
      this.paused = true
      this.options.pause()
      return
    }
    if (this.paused && queuedBytes <= this.lowWaterBytes) this.resume()
  }
}
