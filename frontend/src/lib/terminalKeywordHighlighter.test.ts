import { describe, expect, it } from 'vitest'
import { TerminalKeywordHighlighter, firstEscapeCrossingBoundary } from '@/lib/terminalKeywordHighlighter'

function bytes(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => char.charCodeAt(0))
}

function text(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
}

function render(highlighter: TerminalKeywordHighlighter, input: string, enabled = true): string {
  const emitted = text(highlighter.push(bytes(input), enabled))
  return emitted + text(highlighter.flush())
}

function sgr(color: string): string {
  const hex = color.replace('#', '')
  const r = Number.parseInt(hex.slice(0, 2), 16)
  const g = Number.parseInt(hex.slice(2, 4), 16)
  const b = Number.parseInt(hex.slice(4, 6), 16)
  return `\u001b[38;2;${r};${g};${b}m`
}

const RULES = [
  { keyword: 'Error', color: '#ff5555' },
  { keyword: 'Warning', color: '#ffb86c' },
  { keyword: 'Info', color: '#8be9fd' },
]

describe('TerminalKeywordHighlighter', () => {
  it('wraps a matched keyword with a truecolor SGR and resets it', () => {
    const highlighter = new TerminalKeywordHighlighter(RULES)
    const emitted = highlighter.push(bytes('an Error occurred'), true)
    const flushed = highlighter.flush()
    expect(text(emitted) + text(flushed)).toBe(`an ${sgr('#ff5555')}Error\u001b[0m occurred`)
  })

  it('matches keywords case-insensitively', () => {
    const highlighter = new TerminalKeywordHighlighter(RULES)
    expect(render(highlighter, 'with ERROR and Error').match(/Error/gi)?.length).toBe(2)
  })

  it('matches case-sensitively when caseInsensitive is false', () => {
    const highlighter = new TerminalKeywordHighlighter(RULES, false)
    const output = render(highlighter, 'with ERROR and Error')
    expect(output).toContain(`${sgr('#ff5555')}Error\u001b[0m`)
    expect(output).not.toContain(`${sgr('#ff5555')}ERROR\u001b[0m`)
  })

  it('re-applies the case setting via applyConfig', () => {
    const highlighter = new TerminalKeywordHighlighter(RULES, true)
    expect(render(highlighter, 'down ERROR')).toContain(`${sgr('#ff5555')}ERROR\u001b[0m`)
    highlighter.applyConfig(RULES, false)
    expect(render(highlighter, 'down ERROR')).not.toContain(`${sgr('#ff5555')}`)
    expect(render(highlighter, 'down Error')).toContain(`${sgr('#ff5555')}Error\u001b[0m`)
  })

  it('preserves the original casing of a case-insensitive match', () => {
    const highlighter = new TerminalKeywordHighlighter(RULES)
    const input = 'level=INFO while Info logged'
    const output = render(highlighter, input)
    expect(output).toContain('INFO')
    expect(output).toContain(`${sgr('#8be9fd')}INFO\u001b[0m`)
    expect(output).toContain(`${sgr('#8be9fd')}Info\u001b[0m`)
    expect(output.replace(/\u001b\[[0-9;]*m/g, '')).toBe('level=INFO while Info logged')
  })

  it('does not match keywords inside longer words', () => {
    const highlighter = new TerminalKeywordHighlighter(RULES)
    highlighter.push(bytes('Troubleshooting DiskError Errors'), true)
    expect(text(highlighter.flush())).not.toContain(sgr('#ff5555'))
  })

  it('colors a keyword split across two chunks', () => {
    const highlighter = new TerminalKeywordHighlighter(RULES)
    const first = highlighter.push(bytes('got an Err'), true)
    const second = highlighter.push(bytes('or while running'), true)
    const combined = text(first) + text(second) + text(highlighter.flush())
    expect(combined).toContain(`${sgr('#ff5555')}Error\u001b[0m`)
  })

  it('prefers the longest matching rule at the same position', () => {
    const highlighter = new TerminalKeywordHighlighter([
      { keyword: 'Info', color: '#8be9fd' },
      { keyword: 'Information', color: '#ff0000' },
    ])
    let rendered = ''
    for (const chunk of ['the Information ', 'value is presented clearly now']) rendered += text(highlighter.push(bytes(chunk), true))
    rendered += text(highlighter.flush())
    expect(rendered).toContain(`${sgr('#ff0000')}Information\u001b[0m`)
    expect(rendered).not.toContain('Info\u001b[0m')
  })

  it('does not corrupt pre-existing ANSI escape sequences', () => {
    const highlighter = new TerminalKeywordHighlighter(RULES)
    const output = render(highlighter, '\u001b[1mbold Error reset\u001b[0m')
    expect(output.startsWith('\u001b[1m')).toBe(true)
    expect(output).toContain(`${sgr('#ff5555')}Error\u001b[0m`)
    expect(output).toContain('\u001b[0m')
  })

  it('passes output through unchanged when disabled', () => {
    const highlighter = new TerminalKeywordHighlighter(RULES)
    const input = bytes('no Error here at all')
    expect(text(highlighter.push(input, false))).toBe('no Error here at all')
    expect(text(highlighter.flush())).toBe('')
  })

  it('colours a keyword ending exactly at the stream boundary on flush', () => {
    const highlighter = new TerminalKeywordHighlighter(RULES)
    highlighter.push(bytes('failed: Error'), true)
    expect(highlighter.hasPending()).toBe(true)
    expect(text(highlighter.flush())).toContain(`${sgr('#ff5555')}Error\u001b[0m`)
    expect(highlighter.hasPending()).toBe(false)
  })

  it('colours multiple distinct keywords on one line', () => {
    const highlighter = new TerminalKeywordHighlighter(RULES)
    const output = render(highlighter, 'Info then Warning then Error')
    expect(output).toContain(sgr('#8be9fd'))
    expect(output).toContain(sgr('#ffb86c'))
    expect(output).toContain(sgr('#ff5555'))
  })

  it('detects escapes that cross a hard cut boundary', () => {
    const data = [0x1b, 0x5b, 0x31, 0x6d, 0x78]
    expect(firstEscapeCrossingBoundary(data, 2)).toBe(0)
    expect(firstEscapeCrossingBoundary(data, 6)).toBe(-1)
  })
})
