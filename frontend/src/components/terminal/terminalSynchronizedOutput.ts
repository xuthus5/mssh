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
  nestedFrameReleases: number
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

export class SynchronizedOutputWriter {
  private pending = ''
  private frameBuffer = ''
  private disposed = false
  private syncDepth = 0
  private outputBytes = false
  private timeoutID: number | null = null
  private readonly frameTimeoutMs: number
  private readonly maxBufferedCharacters: number
  private readonly diagnosticsIntervalMs: number
  private readonly onDiagnostics?: (diagnostics: SynchronizedOutputDiagnostics) => void
  private diagnosticsTimeoutID: number | null = null
  private diagnostics: SynchronizedOutputDiagnostics = {
    reason: 'interval', inputChunks: 0, inputBytes: 0, startMarkers: 0, endMarkers: 0,
    completedFrames: 0, nestedFrameReleases: 0, orphanEndMarkers: 0, nestedStartMarkers: 0,
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
    this.pending += data instanceof Uint8Array ? bytesToBinaryString(data) : data
    this.scheduleDiagnostics()
    const ready = this.consume()
    if (this.syncDepth > 0) this.resetFrameTimeout()
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
    while (this.pending) {
      const marker = this.nextMarker()
      if (!marker) {
        const suffixLength = Math.max(
          markerPrefixSuffixLength(this.pending, synchronizedOutputStart),
          markerPrefixSuffixLength(this.pending, synchronizedOutputEnd),
        )
        const readyLength = this.pending.length - suffixLength
        const text = this.pending.slice(0, readyLength)
        this.pending = this.pending.slice(readyLength)
        ready = this.appendText(ready, text)
        break
      }
      const text = this.pending.slice(0, marker.index)
      this.pending = this.pending.slice(marker.index + marker.value.length)
      ready = this.appendText(ready, text)
      ready = marker.value === synchronizedOutputStart ? this.openFrame(ready) : this.closeFrame(ready)
    }
    return ready
  }

  private nextMarker(): { index: number; value: string } | null {
    const start = this.pending.indexOf(synchronizedOutputStart)
    const end = this.pending.indexOf(synchronizedOutputEnd)
    if (start < 0 && end < 0) return null
    if (start >= 0 && (end < 0 || start < end)) return { index: start, value: synchronizedOutputStart }
    return { index: end, value: synchronizedOutputEnd }
  }

  private appendText(ready: string, text: string): string {
    if (!text) return ready
    if (this.syncDepth === 0) return ready + text
    this.frameBuffer += text
    this.updateMaxFrameBytes(this.frameBuffer.length)
    if (this.frameBuffer.length > this.maxBufferedCharacters) return ready + this.releaseFrame('size-limit')
    return ready
  }

  private openFrame(ready: string): string {
    this.diagnostics.startMarkers += 1
    if (this.syncDepth > 0) this.diagnostics.nestedStartMarkers += 1
    if (this.syncDepth === 0) this.frameBuffer = ''
    this.syncDepth += 1
    return ready
  }

  private closeFrame(ready: string): string {
    if (this.syncDepth === 0) {
      this.diagnostics.orphanEndMarkers += 1
      return ready
    }
    this.syncDepth -= 1
    this.diagnostics.endMarkers += 1
    if (this.syncDepth > 1) return ready
    if (this.syncDepth === 1) {
      this.diagnostics.completedFrames += 1
      this.diagnostics.nestedFrameReleases += 1
      const frame = this.frameBuffer
      this.frameBuffer = ''
      return ready + frame
    }
    this.diagnostics.completedFrames += 1
    this.clearTimeout()
    const frame = this.frameBuffer
    this.frameBuffer = ''
    return ready + frame
  }

  private resetFrameTimeout(): void {
    this.clearTimeout()
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
    let data = this.frameBuffer
    if (reason === 'dispose' || reason === 'flush') {
      data += this.pending
      this.pending = ''
    }
    if (reason === 'dispose') this.diagnostics.disposedReleases += 1
    if (reason === 'flush') this.diagnostics.manualFlushes += 1
    if (reason === 'timeout') this.diagnostics.timeoutReleases += 1
    if (reason === 'size-limit') this.diagnostics.sizeLimitReleases += 1
    this.frameBuffer = ''
    this.syncDepth = 0
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
    this.diagnostics.bufferedBytes = this.pending.length + this.frameBuffer.length
    this.diagnostics.synchronized = this.syncDepth > 0
    this.onDiagnostics({ ...this.diagnostics, reason })
  }

  private writeOutput(data: string): void {
    this.write(this.outputBytes ? binaryStringToBytes(data) : data)
  }
}
