import type { Terminal } from '@xterm/xterm'

/** Capture trailing terminal lines, then clamp by UTF-8 byte budget when provided. */
export function captureTerminalContext(
  terminal: Terminal | undefined,
  maxLines: number,
  maxBytes = 0,
): string {
  if (!terminal || maxLines <= 0) return ''
  const buffer = terminal.buffer.active
  const start = Math.max(0, buffer.length - maxLines)
  const lines: string[] = []
  for (let index = start; index < buffer.length; index += 1) {
    const line = buffer.getLine(index)?.translateToString(true) ?? ''
    lines.push(line)
  }
  return clampUTF8Text(lines.join('\n').trim(), maxBytes)
}

export function clampUTF8Text(value: string, maxBytes: number): string {
  if (!value || maxBytes <= 0) return value
  const encoder = new TextEncoder()
  const encoded = encoder.encode(value)
  if (encoded.length <= maxBytes) return value
  // Drop whole code points from the start so we keep the most recent context.
  let start = encoded.length - maxBytes
  while (start < encoded.length && (encoded[start] & 0xc0) === 0x80) {
    start += 1
  }
  return new TextDecoder().decode(encoded.subarray(start)).trimStart()
}
