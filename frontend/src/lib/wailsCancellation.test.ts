import { describe, expect, it, vi } from 'vitest'
import { bindWailsCallToSignal } from '@/lib/wailsCancellation'

describe('bindWailsCallToSignal', () => {
  it('returns the original promise when no signal is provided', async () => {
    const call = Promise.resolve('ok')
    expect(bindWailsCallToSignal(call)).toBe(call)
    await expect(call).resolves.toBe('ok')
  })

  it('binds cancellable Wails promises to the supplied signal', async () => {
    const controller = new AbortController()
    const bound = Promise.resolve('bound')
    const call = Promise.resolve('original') as Promise<string> & {
      cancelOn: (signal: AbortSignal) => Promise<string>
    }
    call.cancelOn = vi.fn(() => bound)

    expect(bindWailsCallToSignal(call, controller.signal)).toBe(bound)
    expect(call.cancelOn).toHaveBeenCalledWith(controller.signal)
  })
})
