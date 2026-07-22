import { beforeEach, describe, expect, it } from 'vitest'
import { recordCommand } from '@/lib/commandHistory'
import { findHistoryCompletion, suggestHistoryCompletion } from '@/lib/commandHistoryPredict'

describe('findHistoryCompletion', () => {
  it('returns suffix for most recent matching prefix', () => {
    expect(findHistoryCompletion('git co', [
      'git commit -m "feat"',
      'git checkout main',
      'ls',
    ])).toBe('mmit -m "feat"')
  })

  it('skips exact matches and empty prefixes', () => {
    expect(findHistoryCompletion('git status', ['git status', 'git status --short'])).toBe(' --short')
    expect(findHistoryCompletion('', ['ls'])).toBeNull()
    expect(findHistoryCompletion('   ', ['ls'])).toBeNull()
    expect(findHistoryCompletion('zzz', ['ls'])).toBeNull()
  })

  it('dedupes repeated history entries', () => {
    expect(findHistoryCompletion('echo ', ['echo hi', 'echo hi', 'echo bye'])).toBe('hi')
  })
})

describe('suggestHistoryCompletion', () => {
  beforeEach(() => localStorage.clear())

  it('reads per-session history', () => {
    recordCommand(1, 'kubectl get pods -n prod')
    recordCommand(1, 'kubectl apply -f deploy.yaml')
    recordCommand(2, 'docker ps')
    expect(suggestHistoryCompletion('kubectl g', 1)).toBe('et pods -n prod')
    expect(suggestHistoryCompletion('docker', 1)).toBeNull()
    expect(suggestHistoryCompletion('docker', 2)).toBe(' ps')
  })
})
