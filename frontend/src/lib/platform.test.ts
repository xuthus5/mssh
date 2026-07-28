import { afterEach, describe, expect, it } from 'vitest'
import { isWindowsPlatform } from '@/lib/platform'

describe('isWindowsPlatform', () => {
  const original = navigator.platform
  afterEach(() => {
    Object.defineProperty(navigator, 'platform', { value: original, configurable: true })
  })

  it('returns true on Win32 platform', () => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true })
    expect(isWindowsPlatform()).toBe(true)
  })

  it('returns true on Windows arm64 platform string', () => {
    Object.defineProperty(navigator, 'platform', { value: 'Windows arm64', configurable: true })
    expect(isWindowsPlatform()).toBe(true)
  })

  it('returns false on MacIntel platform', () => {
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })
    expect(isWindowsPlatform()).toBe(false)
  })

  it('returns false on Linux x86_64 platform', () => {
    Object.defineProperty(navigator, 'platform', { value: 'Linux x86_64', configurable: true })
    expect(isWindowsPlatform()).toBe(false)
  })
})
