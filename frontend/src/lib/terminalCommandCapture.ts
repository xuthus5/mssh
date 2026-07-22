export class TerminalCommandCapture {
  private buffer = ''
  private escape = false
  private tmuxPrefix = false

  current(): string {
    return this.buffer
  }

  feed(data: string): string[] {
    const commands: string[] = []
    for (const character of data) {
      if (this.escape) {
        if (character === '[' || character === ']' || character === 'O') continue
        if (character >= '@' && character <= '~') this.escape = false
        continue
      }
      if (this.tmuxPrefix) { this.tmuxPrefix = false; continue }
      if (character === '\u001b') { this.escape = true; continue }
      if (character === '\u0002') { this.tmuxPrefix = true; continue }
      if (character === '\r' || character === '\n') {
        const command = this.buffer.trim()
        if (command) commands.push(command)
        this.buffer = ''
        continue
      }
      if (character === '\u007f' || character === '\b') { this.buffer = this.buffer.slice(0, -1); continue }
      if (character === '\u0015' || character === '\u0003') { this.buffer = ''; continue }
      if (character === '\u0017') { this.buffer = this.buffer.trimEnd().replace(/\S+$/, ''); continue }
      if (character >= ' ') this.buffer += character
    }
    return commands
  }
}
