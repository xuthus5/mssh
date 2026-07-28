import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { createOutputPauseRequester } from '@/hooks/terminalOutputRuntime'

describe('createOutputPauseRequester', () => {
  it('serializes pause and resume requests in desired-state order', async () => {
    const terminalIDRef = createRef<string>()
    terminalIDRef.current = 'term-flow'
    const calls: Array<{ terminalID: string; paused: boolean }> = []
    let releasePause!: () => void
    const pausePromise = new Promise<void>((resolve) => { releasePause = resolve })
    const setOutputPaused = (terminalID: string, paused: boolean) => {
      calls.push({ terminalID, paused })
      return paused ? pausePromise : Promise.resolve()
    }
    const request = createOutputPauseRequester(terminalIDRef, setOutputPaused)

    request(true)
    request(false)
    expect(calls).toEqual([{ terminalID: 'term-flow', paused: true }])
    releasePause()
    await Promise.resolve()
    await Promise.resolve()

    expect(calls).toEqual([
      { terminalID: 'term-flow', paused: true },
      { terminalID: 'term-flow', paused: false },
    ])
  })

  it('stops retrying after one failed compensating resume', async () => {
    const terminalIDRef = createRef<string>()
    terminalIDRef.current = 'term-flow'
    const setOutputPaused = vi.fn(async () => {
      if (setOutputPaused.mock.calls.length <= 2) throw new Error('runtime unavailable')
    })
    const request = createOutputPauseRequester(terminalIDRef, setOutputPaused)

    request(true)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(setOutputPaused.mock.calls).toEqual([
      ['term-flow', true],
      ['term-flow', false],
    ])
  })

  it('retries a failed resume after a successful pause', async () => {
    const terminalIDRef = createRef<string>()
    terminalIDRef.current = 'term-flow'
    let resumeAttempts = 0
    const setOutputPaused = vi.fn(async (_terminalID: string, paused: boolean) => {
      if (!paused) {
        resumeAttempts++
        if (resumeAttempts === 1) throw new Error('transient resume failure')
      }
    })
    const unavailable = vi.fn()
    const request = createOutputPauseRequester(terminalIDRef, setOutputPaused, unavailable)

    request(true)
    await Promise.resolve()
    request(false)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(setOutputPaused.mock.calls).toEqual([
      ['term-flow', true],
      ['term-flow', false],
      ['term-flow', false],
    ])
    expect(unavailable).not.toHaveBeenCalled()
  })

  it('notifies the flow after every resume attempt fails', async () => {
    const terminalIDRef = createRef<string>()
    terminalIDRef.current = 'term-flow'
    const unavailable = vi.fn()
    const setOutputPaused = vi.fn(async (_terminalID: string, paused: boolean) => {
      if (!paused) throw new Error('resume unavailable')
    })
    const request = createOutputPauseRequester(terminalIDRef, setOutputPaused, unavailable)

    request(true)
    await Promise.resolve()
    request(false)
    for (let attempt = 0; attempt < 8; attempt++) await Promise.resolve()

    expect(setOutputPaused.mock.calls).toEqual([
      ['term-flow', true],
      ['term-flow', false],
      ['term-flow', false],
      ['term-flow', false],
    ])
    expect(unavailable).toHaveBeenCalledOnce()
  })

  it('notifies the flow when a pause request cannot be applied', async () => {
    const terminalIDRef = createRef<string>()
    terminalIDRef.current = 'term-flow'
    const unavailable = vi.fn()
    const setOutputPaused = vi.fn(async () => { throw new Error('runtime unavailable') })
    const request = createOutputPauseRequester(terminalIDRef, setOutputPaused, unavailable)

    request(true)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(unavailable).toHaveBeenCalledOnce()
  })
})
