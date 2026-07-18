const synchronizedOutputStart = '\u001b[?2026h'
const synchronizedOutputEnd = '\u001b[?2026l'
const defaultFrameTimeoutMs = 500
const defaultMaxBufferedCharacters = 1 << 20

interface Options {
  frameTimeoutMs?: number
  maxBufferedCharacters?: number
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
  private buffer = ''
  private disposed = false
  private synchronized = false
  private outputBytes = false
  private timeoutID: number | null = null
  private readonly frameTimeoutMs: number
  private readonly maxBufferedCharacters: number

  constructor(private readonly write: (data: TerminalOutput) => void, options: Options = {}) {
    this.frameTimeoutMs = options.frameTimeoutMs ?? defaultFrameTimeoutMs
    this.maxBufferedCharacters = options.maxBufferedCharacters ?? defaultMaxBufferedCharacters
  }

  push(data: TerminalOutput): void {
    if (this.disposed || data.length === 0) return
    if (data instanceof Uint8Array) this.outputBytes = true
    this.buffer += data instanceof Uint8Array ? bytesToBinaryString(data) : data
    const ready = this.consume()
    if (ready) this.writeOutput(ready)
  }

  dispose(): void {
    if (this.disposed) return
    this.clearTimeout()
    const data = this.releaseFrame()
    this.disposed = true
    if (data) this.writeOutput(data)
  }

  flush(): void {
    if (this.disposed) return
    this.clearTimeout()
    this.flushBuffered()
  }

  private consume(): string {
    let ready = ''
    while (this.buffer) {
      if (this.synchronized) {
        const end = this.buffer.indexOf(synchronizedOutputEnd)
        if (end < 0) {
          if (this.buffer.length > this.maxBufferedCharacters) ready += this.releaseFrame()
          else this.scheduleTimeout()
          break
        }
        ready += this.buffer.slice(0, end)
        this.buffer = this.buffer.slice(end + synchronizedOutputEnd.length)
        this.synchronized = false
        this.clearTimeout()
        continue
      }
      const start = this.buffer.indexOf(synchronizedOutputStart)
      if (start >= 0) {
        ready += this.buffer.slice(0, start)
        this.buffer = this.buffer.slice(start + synchronizedOutputStart.length)
        this.synchronized = true
        this.scheduleTimeout()
        continue
      }
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
      this.flushBuffered()
    }, this.frameTimeoutMs)
  }

  private clearTimeout(): void {
    if (this.timeoutID === null) return
    window.clearTimeout(this.timeoutID)
    this.timeoutID = null
  }

  private releaseFrame(): string {
    const data = this.buffer
    this.buffer = ''
    this.synchronized = false
    this.clearTimeout()
    return data
  }

  private flushBuffered(): void {
    const data = this.releaseFrame()
    if (data) this.writeOutput(data)
  }

  private writeOutput(data: string): void {
    this.write(this.outputBytes ? binaryStringToBytes(data) : data)
  }
}
