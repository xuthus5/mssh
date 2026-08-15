import { beforeEach, describe, expect, it } from 'vitest'
import { recordCommand } from '@/lib/commandHistory'
import {
  predictCommandTokens,
  readSessionCommands,
  splitCommandTokens,
} from '@/lib/commandHistoryPredict'

describe('splitCommandTokens', () => {
  it('splits on whitespace and drops empties', () => {
    expect(splitCommandTokens('ls -lahrt /usr/local/bin/claude')).toEqual([
      'ls', '-lahrt', '/usr/local/bin/claude',
    ])
    expect(splitCommandTokens('  git   status ')).toEqual(['git', 'status'])
    expect(splitCommandTokens('')).toEqual([])
  })
})

describe('predictCommandTokens', () => {
  const history = [
    'ls -lahrt /usr/local/bin/claude',
    'ls -l /tmp',
    'git status',
    'git commit -m "ship"',
    'kubectl get pods -n prod',
    'ls',
  ]

  it('predicts next token after a known complete command', () => {
    const result = predictCommandTokens('ls', history)
    expect(result.mode).toBe('next')
    expect(result.tokens[0]).toBe('-lahrt')
    expect(result.tokens).toContain('-l')
  })

  it('continues the chain token by token', () => {
    expect(predictCommandTokens('ls -lahrt', history).tokens[0]).toBe('/usr/local/bin/claude')
    expect(predictCommandTokens('ls -lahrt /usr/local/bin/claude', history).tokens).toEqual([])
  })

  it('completes a partial token with prefix candidates', () => {
    const result = predictCommandTokens('ls -la', history)
    expect(result.mode).toBe('prefix')
    expect(result.tokens).toEqual(['-lahrt'])
  })

  it('suggests full command suffixes for a partial first token, newest first', () => {
    const result = predictCommandTokens('gi', history)
    expect(result.mode).toBe('command')
    expect(result.tokens).toEqual(['t status', 't commit -m "ship"'])
  })

  it('suggests command names when no full command shares the prefix', () => {
    const result = predictCommandTokens('ku', ['kubectl get pods -n prod'])
    expect(result.mode).toBe('command')
    expect(result.tokens).toEqual(['bectl get pods -n prod'])
  })

  it('ranks by frequency then recency', () => {
    const ranked = predictCommandTokens('git', history)
    expect(ranked.mode).toBe('next')
    expect(ranked.tokens[0]).toBe('status')
  })

  it('returns empty for blank lines and unknown input', () => {
    expect(predictCommandTokens('', history).tokens).toEqual([])
    expect(predictCommandTokens('   ', history).tokens).toEqual([])
    expect(predictCommandTokens('zzz', history).tokens).toEqual([])
    expect(predictCommandTokens('docker', history).tokens).toEqual([])
  })

  it('does not suggest the immediately preceding token', () => {
    const result = predictCommandTokens('ls ', ['ls ls -la'])
    expect(result.tokens).not.toContain('ls')
  })

  it('caps candidate list size', () => {
    const wide = Array.from({ length: 20 }, (_, index) => `cmd arg${index}`)
    const result = predictCommandTokens('cmd', wide)
    expect(result.tokens.length).toBeLessThanOrEqual(8)
  })

  it('treats a partial that is also a known full token as complete', () => {
    const chain = ['kubectl apply -f deploy.yaml', 'kubectl get pods']
    const partial = predictCommandTokens('kubectl g', chain)
    expect(partial.mode).toBe('prefix')
    expect(partial.tokens).toEqual(['get'])
    const complete = predictCommandTokens('kubectl get', chain)
    expect(complete.mode).toBe('next')
    expect(complete.tokens).toEqual(['pods'])
  })

  it('prioritizes the most recent full command for a partial first token', () => {
    // History is time-descending: ls /root was executed most recently.
    const history = [
      'ls /root',
      'ls -lahrt /tmp',
    ]
    const result = predictCommandTokens('l', history)
    expect(result.mode).toBe('command')
    expect(result.tokens).toEqual(['s /root', 's -lahrt /tmp'])
  })

  it('dedupes identical command suffixes keeping the newest one', () => {
    const history = [
      'git status',
      'git status --short',
      'git status',
    ]
    const result = predictCommandTokens('g', history)
    expect(result.mode).toBe('command')
    expect(result.tokens).toEqual(['it status', 'it status --short'])
  })
})

describe('readSessionCommands', () => {
  beforeEach(() => localStorage.clear())

  it('reads per-session commands newest first', () => {
    recordCommand(1, 'kubectl get pods -n prod')
    recordCommand(1, 'kubectl apply -f deploy.yaml')
    recordCommand(2, 'docker ps')
    expect(readSessionCommands(1)).toEqual([
      'kubectl apply -f deploy.yaml',
      'kubectl get pods -n prod',
    ])
    expect(readSessionCommands(2)).toEqual(['docker ps'])
    expect(readSessionCommands(Number.NaN)).toEqual([])
  })
})
