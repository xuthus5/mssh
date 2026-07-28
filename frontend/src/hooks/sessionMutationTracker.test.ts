import { describe, expect, it } from 'vitest'
import { SessionMutationTracker } from '@/hooks/sessionMutationTracker'

describe('SessionMutationTracker', () => {
  it('keeps only the newest generation for each session', () => {
    const tracker = new SessionMutationTracker()
    const older = tracker.begin('1')
    const newer = tracker.begin('1')

    expect(tracker.isCurrent('1', older)).toBe(false)
    expect(tracker.isCurrent('1', newer)).toBe(true)
    expect(tracker.size).toBe(1)
  })

  it('does not let an older completion remove a newer generation', () => {
    const tracker = new SessionMutationTracker()
    const older = tracker.begin('1')
    const newer = tracker.begin('1')

    tracker.finish('1', older)

    expect(tracker.isCurrent('1', newer)).toBe(true)
    expect(tracker.size).toBe(1)
  })

  it('releases completed and invalidated sessions', () => {
    const tracker = new SessionMutationTracker()
    const first = tracker.begin('1')
    const second = tracker.begin('2')

    tracker.finish('1', first)
    tracker.invalidate(['2', 'missing', '2'])

    expect(tracker.size).toBe(0)
    expect(tracker.isCurrent('1', first)).toBe(false)
    expect(tracker.isCurrent('2', second)).toBe(false)
  })

  it('does not reuse an invalidated generation for the same session', () => {
    const tracker = new SessionMutationTracker()
    const older = tracker.begin('1')
    tracker.invalidate(['1'])
    const newer = tracker.begin('1')

    expect(tracker.isCurrent('1', older)).toBe(false)
    expect(tracker.isCurrent('1', newer)).toBe(true)
  })

  it('does not retain completed session IDs over repeated mutations', () => {
    const tracker = new SessionMutationTracker()
    for (let index = 0; index < 1000; index += 1) {
      const sessionID = String(index)
      tracker.finish(sessionID, tracker.begin(sessionID))
    }

    expect(tracker.size).toBe(0)
  })
})
