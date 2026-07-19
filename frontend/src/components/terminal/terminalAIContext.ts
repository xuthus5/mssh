import type { Terminal } from '@xterm/xterm'

export function captureTerminalContext(terminal: Terminal | undefined, maxLines: number): string {
  if (!terminal || maxLines <= 0) return ''
  const buffer = terminal.buffer.active
  const start = Math.max(0, buffer.length - maxLines)
  const lines: string[] = []
  for (let index = start; index < buffer.length; index += 1) {
    const line = buffer.getLine(index)?.translateToString(true) ?? ''
    lines.push(line)
  }
  return lines.join('\n').trim()
}
