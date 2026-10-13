import { describe, expect, it } from 'vitest'
import {
  claimBackgroundHostKeyPromptTab,
  currentBackgroundHostKeyPromptTab,
} from '@/store/hostKeyPromptOwnership'

describe('background host key prompt ownership', () => {
  it('resolves the most recent claim and forgets it after release', () => {
    expect(currentBackgroundHostKeyPromptTab()).toBeNull()

    const releaseFirst = claimBackgroundHostKeyPromptTab('tab-1')
    expect(currentBackgroundHostKeyPromptTab()).toBe('tab-1')

    const releaseSecond = claimBackgroundHostKeyPromptTab('tab-2')
    expect(currentBackgroundHostKeyPromptTab()).toBe('tab-2')

    releaseSecond()
    expect(currentBackgroundHostKeyPromptTab()).toBe('tab-1')

    releaseFirst()
    expect(currentBackgroundHostKeyPromptTab()).toBeNull()
  })

  it('is idempotent when released twice', () => {
    const release = claimBackgroundHostKeyPromptTab('tab-1')
    release()
    release()
    expect(currentBackgroundHostKeyPromptTab()).toBeNull()
  })
})
