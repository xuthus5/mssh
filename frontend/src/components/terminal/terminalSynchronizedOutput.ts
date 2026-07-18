const synchronizedOutputStart = '\u001b[?2026h'
const synchronizedOutputEnd = '\u001b[?2026l'
const defaultFrameTimeoutMs = 500
const defaultMaxBufferedCharacters = 1 << 20
const defaultDiagnosticsIntervalMs = 1000
type SynchronizedOutputDiagnosticsReason = 'interval' | 'timeout' | 'size-limit' | 'dispose'

export interface SynchronizedOutputDiagnostics {
  reason: SynchronizedOutputDiagnosticsReason
  inputChunks: number
  inputBytes: number
  startMarkers: number
  endMarkers: number
  completedFrames: number
  orphanEndMarkers: number
  nestedStartMarkers: number
  timeoutReleases: number
  sizeLimitReleases: number
  manualFlushes: number
  disposedReleases: number
  bufferedBytes: number
  synchronized: boolean
  maxFrameBytes: number
}

export interface SynchronizedOutputOptions {
  frameTimeoutMs?: number
  maxBufferedCharacters?: number
  diagnosticsIntervalMs?: number
  onDiagnostics?: (diagnostics: SynchronizedOutputDiagnostics) => void
}

type TerminalOutput = string | Uint8Array

function bytesToBinaryString(data: Uint8Array): string {
  let result = ''
  const chunkSize = 8192
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    result += String.fromCharCode(...data.subarray(offset, offset + chunkSize))
  }
  return result
}

function binaryStringToBytes(data: string): Uint8Array {
  return Uint8Array.from(data, (character) => character.charCodeAt(0))
}

function markerPrefixSuffixLength(value: string, marker: string): number {
  const limit = Math.min(value.length, marker.length - 1)
  for (let length = limit; length > 0; length -= 1) {
    if (value.endsWith(marker.slice(0, length))) return length
  }
  return 0
}

function countOccurrences(value: string, marker: string): number {
  let count = 0
  let offset = 0
  while (offset < value.length) {
    const index = value.indexOf(marker, offset)
    if (index < 0) break
    count += 1
    offset = index + marker.length
  }
  return count
}

export class SynchronizedOutputWriter {
  private buffer = ''
  private disposed = false
  private synchronized = false
  private outputBytes = false
  private timeoutID: number | null = null
  private readonly frameTimeoutMs: number
  private readonly maxBufferedCharacters: number
  private readonly diagnosticsIntervalMs: number
  private readonly onDiagnostics?: (diagnostics: SynchronizedOutputDiagnostics) => void
  private diagnosticsTimeoutID: number | null = null
  private diagnostics: SynchronizedOutputDiagnostics = {
    reason: 'interval', inputChunks: 0, inputBytes: 0, startMarkers: 0, endMarkers: 0,
    completedFrames: 0, orphanEndMarkers: 0, nestedStartMarkers: 0,
    timeoutReleases: 0, sizeLimitReleases: 0, manualFlushes: 0,
    disposedReleases: 0, bufferedBytes: 0, synchronized: false, maxFrameBytes: 0,
  }

  constructor(private readonly write: (data: TerminalOutput) => void, options: SynchronizedOutputOptions = {}) {
    this.frameTimeoutMs = options.frameTimeoutMs ?? defaultFrameTimeoutMs
    this.maxBufferedCharacters = options.maxBufferedCharacters ?? defaultMaxBufferedCharacters
    this.diagnosticsIntervalMs = options.diagnosticsIntervalMs ?? defaultDiagnosticsIntervalMs
    this.onDiagnostics = options.onDiagnostics
  }

  push(data: TerminalOutput): void {
    if (this.disposed || data.length === 0) return
    this.diagnostics.inputChunks += 1
    this.diagnostics.inputBytes += data.length
    if (data instanceof Uint8Array) this.outputBytes = true
    this.buffer += data instanceof Uint8Array ? bytesToBinaryString(data) : data
    this.scheduleDiagnostics()
    const ready = this.consume()
    if (ready) this.writeOutput(ready)
  }

  dispose(): void {
    if (this.disposed) return
    this.clearTimeout()
    this.clearDiagnosticsTimeout()
    const data = this.releaseFrame('dispose')
    this.disposed = true
    if (data) this.writeOutput(data)
    this.reportDiagnostics('dispose')
  }

  flush(): void {
    if (this.disposed) return
    this.clearTimeout()
    this.flushBuffered('flush')
  }

  private consume(): string {
    let ready = ''
    while (this.buffer) {
      if (this.synchronized) {
        const end = this.buffer.indexOf(synchronizedOutputEnd)
        if (end < 0) {
          this.updateMaxFrameBytes(this.buffer.length)
          if (this.buffer.length > this.maxBufferedCharacters) ready += this.releaseFrame('size-limit')
          else this.scheduleTimeout()
          break
        }
        this.updateMaxFrameBytes(end)
        this.diagnostics.nestedStartMarkers += countOccurrences(this.buffer.slice(0, end), synchronizedOutputStart)
        ready += this.buffer.slice(0, end)
        this.buffer = this.buffer.slice(end + synchronizedOutputEnd.length)
        this.synchronized = false
        this.diagnostics.endMarkers += 1
        this.diagnostics.completedFrames += 1
        this.clearTimeout()
        continue
      }
      const start = this.buffer.indexOf(synchronizedOutputStart)
      if (start >= 0) {
        ready += this.buffer.slice(0, start)
        this.buffer = this.buffer.slice(start + synchronizedOutputStart.length)
        this.synchronized = true
        this.diagnostics.startMarkers += 1
        this.scheduleTimeout()
        continue
      }
      this.diagnostics.orphanEndMarkers += countOccurrences(this.buffer, synchronizedOutputEnd)
      const suffixLength = markerPrefixSuffixLength(this.buffer, synchronizedOutputStart)
      const readyLength = this.buffer.length - suffixLength
      ready += this.buffer.slice(0, readyLength)
      this.buffer = this.buffer.slice(readyLength)
      break
    }
    return ready
  }

  private scheduleTimeout(): void {
    if (this.timeoutID !== null) return
    this.timeoutID = window.setTimeout(() => {
      this.timeoutID = null
      this.flushBuffered('timeout')
    }, this.frameTimeoutMs)
  }

  private clearTimeout(): void {
    if (this.timeoutID === null) return
    window.clearTimeout(this.timeoutID)
    this.timeoutID = null
  }

  private releaseFrame(reason: 'dispose' | 'flush' | 'timeout' | 'size-limit'): string {
    const data = this.buffer
    if (this.synchronized) {
      this.updateMaxFrameBytes(data.length)
      this.diagnostics.nestedStartMarkers += countOccurrences(data, synchronizedOutputStart)
    }
    if (reason === 'dispose') this.diagnostics.disposedReleases += 1
    if (reason === 'flush') this.diagnostics.manualFlushes += 1
    if (reason === 'timeout') this.diagnostics.timeoutReleases += 1
    if (reason === 'size-limit') this.diagnostics.sizeLimitReleases += 1
    this.buffer = ''
    this.synchronized = false
    this.clearTimeout()
    if (reason === 'timeout' || reason === 'size-limit') this.reportDiagnostics(reason)
    return data
  }

  private flushBuffered(reason: 'flush' | 'timeout'): void {
    const data = this.releaseFrame(reason)
    if (data) this.writeOutput(data)
  }

  private updateMaxFrameBytes(size: number): void {
    this.diagnostics.maxFrameBytes = Math.max(this.diagnostics.maxFrameBytes, size)
  }

  private scheduleDiagnostics(): void {
    if (!this.onDiagnostics || this.diagnosticsTimeoutID !== null) return
    this.diagnosticsTimeoutID = window.setTimeout(() => {
      this.diagnosticsTimeoutID = null
      this.reportDiagnostics('interval')
    }, this.diagnosticsIntervalMs)
  }

  private clearDiagnosticsTimeout(): void {
    if (this.diagnosticsTimeoutID === null) return
    window.clearTimeout(this.diagnosticsTimeoutID)
    this.diagnosticsTimeoutID = null
  }

  private reportDiagnostics(reason: SynchronizedOutputDiagnosticsReason): void {
    if (!this.onDiagnostics) return
    this.diagnostics.bufferedBytes = this.buffer.length
    this.diagnostics.synchronized = this.synchronized
    this.onDiagnostics({ ...this.diagnostics, reason })
  }

  private writeOutput(data: string): void {
    this.write(this.outputBytes ? binaryStringToBytes(data) : data)
  }
}
