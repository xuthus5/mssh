const defaultMaxPendingChunks = 8192

export interface TerminalOutputSequencerOptions {
  maxPendingChunks?: number
}

export class TerminalOutputSequencer {
  private nextSequence = 1
  private readonly pending = new Map<number, Uint8Array>()
  private readonly maxPendingChunks: number

  constructor(
    private readonly write: (data: Uint8Array) => void,
    options: TerminalOutputSequencerOptions = {},
  ) {
    this.maxPendingChunks = options.maxPendingChunks ?? defaultMaxPendingChunks
  }

  push(sequence: number, data: Uint8Array): void {
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new Error(`invalid terminal output sequence: ${sequence}`)
    }
    if (sequence < this.nextSequence || this.pending.has(sequence)) return
    if (sequence > this.nextSequence && this.pending.size >= this.maxPendingChunks) {
      throw new Error(`terminal output sequence gap exceeded ${this.maxPendingChunks} chunks`)
    }
    this.pending.set(sequence, data)
    this.drain()
  }

  private drain(): void {
    while (this.pending.has(this.nextSequence)) {
      const data = this.pending.get(this.nextSequence)
      this.pending.delete(this.nextSequence)
      this.nextSequence += 1
      if (data) this.write(data)
    }
  }
}
