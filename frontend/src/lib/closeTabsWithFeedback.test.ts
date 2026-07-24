import { beforeEach, describe, expect, it, vi } from 'vitest'

const { logError } = vi.hoisted(() => ({
  logError: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({ logger: { error: logError } }))

import { closeTabsWithFeedback } from '@/lib/closeTabsWithFeedback'
import { useAppStore } from '@/store/appStore'

describe('closeTabsWithFeedback', () => {
  beforeEach(() => {
    logError.mockReset()
    useAppStore.setState({ shellActionError: '' })
  })

  it('consumes rejected closes and reports the error on the shell banner', async () => {
    const closeTab = vi.fn(async () => { throw new Error('connection lost') })

    const result = closeTabsWithFeedback(['terminal-1'], closeTab)

    expect(result).toBeUndefined()
    await vi.waitFor(() => expect(useAppStore.getState().shellActionError).toBe('关闭标签失败: connection lost'))
    expect(logError).toHaveBeenCalledWith(
      'close tab failed',
      expect.objectContaining({ tabId: 'terminal-1', error: expect.any(Error) }),
    )
  })

  it('attempts every tab in a batch', async () => {
    const closeTab = vi.fn(async () => {})

    closeTabsWithFeedback(['a', 'b'], closeTab)

    await vi.waitFor(() => expect(closeTab).toHaveBeenCalledTimes(2))
    expect(closeTab).toHaveBeenNthCalledWith(1, 'a')
    expect(closeTab).toHaveBeenNthCalledWith(2, 'b')
  })

  it('prefers custom error owner over shell banner', async () => {
    const closeTab = vi.fn(async () => { throw new Error('connection lost') })
    const onError = vi.fn()

    closeTabsWithFeedback(['terminal-1'], closeTab, onError)

    await vi.waitFor(() => expect(onError).toHaveBeenCalled())
    expect(onError).toHaveBeenCalledWith('terminal-1', expect.any(Error))
    expect(useAppStore.getState().shellActionError).toBe('')
  })
})
