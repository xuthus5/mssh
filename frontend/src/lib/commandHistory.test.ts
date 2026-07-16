import { beforeEach, describe, expect, it } from 'vitest'
import { clearCommandHistory, readCommandHistory, recordCommand } from '@/lib/commandHistory'

describe('command history', () => {
  beforeEach(() => localStorage.clear())
  it('records commands per session and filters sensitive values', () => {
    recordCommand(1, 'ls -la')
    recordCommand(1, 'echo --password secret')
    recordCommand(2, 'pwd')
    expect(readCommandHistory(1)).toHaveLength(1)
    expect(readCommandHistory(1)[0].command).toBe('ls -la')
    expect(readCommandHistory(2)[0].command).toBe('pwd')
  })
  it('clears a session history', () => {
    recordCommand(1, 'pwd')
    clearCommandHistory(1)
    expect(readCommandHistory(1)).toEqual([])
  })
})
