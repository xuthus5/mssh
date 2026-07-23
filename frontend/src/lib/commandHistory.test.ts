import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearCommandHistory,
  isSensitiveCommand,
  readCommandHistory,
  recordCommand,
  trimCommandHistory,
} from '@/lib/commandHistory'

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

  it('trims by entry and byte budgets', () => {
    const entries = Array.from({ length: 20 }, (_, index) => ({
      id: String(index),
      command: 'x'.repeat(100),
      createdAt: index,
    }))
    const trimmed = trimCommandHistory(entries, { maxEntries: 5, maxBytes: 800 })
    expect(trimmed.length).toBeLessThanOrEqual(5)
    expect(trimmed.length).toBeGreaterThan(0)
  })
})

describe('isSensitiveCommand matrix', () => {
  it.each([
    ['echo --password secret', true],
    ['export OPENAI_API_KEY=sk-test', true],
    ['curl -H "Authorization: Bearer abc"', true],
    ['sshpass -p secret ssh host', true],
    ['mysql -uroot -psecret', true],
    ['AWS_SECRET_ACCESS_KEY=x aws s3 ls', true],
    ['ls -la', false],
    ['git status', false],
    ['echo hello', false],
    ['pacman -Syu', false],
    ['ps -p 1', false],
    ['docker ps -p', false],
  ])('%s => %s', (command, expected) => {
    expect(isSensitiveCommand(command)).toBe(expected)
  })
})
