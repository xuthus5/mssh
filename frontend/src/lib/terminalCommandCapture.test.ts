import { describe, expect, it } from 'vitest'
import { TerminalCommandCapture } from '@/lib/terminalCommandCapture'

describe('TerminalCommandCapture', () => {
  it('captures submitted commands and editing controls', () => {
    const capture = new TerminalCommandCapture()
    expect(capture.feed('git stats\u007fus\r')).toEqual(['git status'])
    expect(capture.feed('echo secret\u0015pwd\r')).toEqual(['pwd'])
    expect(capture.feed('git checkout wrong\u0017main\r')).toEqual(['git checkout main'])
  })

  it('ignores ANSI navigation and tmux prefix sequences', () => {
    const capture = new TerminalCommandCapture()
    expect(capture.feed('ls\u001b[A\u0002c\r')).toEqual(['ls'])
  })

  it('captures multiline pasted commands independently', () => {
    const capture = new TerminalCommandCapture()
    expect(capture.feed('echo one\necho two\r')).toEqual(['echo one', 'echo two'])
  })
})
