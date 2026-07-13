import { beforeEach, describe, expect, it, vi } from 'vitest'

const { logError, showToast } = vi.hoisted(() => ({
  logError: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({ logger: { error: logError } }))
vi.mock('@/components/ui/toast', () => ({ toast: showToast }))

import { closeTabsWithFeedback } from '@/lib/closeTabsWithFeedback'

describe('closeTabsWithFeedback', () => {
  beforeEach(() => {
    logError.mockReset()
    showToast.mockReset()
  })

  it('consumes rejected closes and reports the error', async () => {
    const closeTab = vi.fn(async () => { throw new Error('connection lost') })

    const result = closeTabsWithFeedback(['terminal-1'], closeTab)

    expect(result).toBeUndefined()
    await vi.waitFor(() => expect(showToast).toHaveBeenCalled())
    expect(logError).toHaveBeenCalledWith(
      'close tab failed',
      expect.objectContaining({ tabId: 'terminal-1', error: expect.any(Error) }),
    )
    expect(showToast).toHaveBeenCalledWith('关闭标签失败: connection lost', 'error')
  })

  it('attempts every tab in a batch', async () => {
    const closeTab = vi.fn(async () => {})

    closeTabsWithFeedback(['a', 'b'], closeTab)

    await vi.waitFor(() => expect(closeTab).toHaveBeenCalledTimes(2))
    expect(closeTab).toHaveBeenNthCalledWith(1, 'a')
    expect(closeTab).toHaveBeenNthCalledWith(2, 'b')
  })
})
