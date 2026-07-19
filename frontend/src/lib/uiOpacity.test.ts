import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyWindowOpacity,
  clampWindowOpacity,
  isNativeWindowOpacitySupported,
  windowOpacitySupportMessage,
} from '@/lib/uiOpacity'

describe('uiOpacity', () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty('--app-opacity')
    document.documentElement.style.removeProperty('--app-background-alpha')
    delete document.documentElement.dataset.windowOpacity
  })

  it('clamps opacity to the supported range', () => {
    expect(clampWindowOpacity(40)).toBe(50)
    expect(clampWindowOpacity(75.4)).toBe(75)
    expect(clampWindowOpacity(120)).toBe(100)
    expect(clampWindowOpacity(Number.NaN)).toBe(100)
  })

  it('applies opacity as CSS variables for translucent backgrounds', () => {
    applyWindowOpacity(82)
    expect(document.documentElement.style.getPropertyValue('--app-opacity')).toBe('0.82')
    expect(document.documentElement.style.getPropertyValue('--app-background-alpha')).toBe('0.82')
    expect(document.documentElement.dataset.windowOpacity).toBe('82')
  })

  it('reports native support only for windows and mac', () => {
    expect(isNativeWindowOpacitySupported('windows')).toBe(true)
    expect(isNativeWindowOpacitySupported('mac')).toBe(true)
    expect(isNativeWindowOpacitySupported('linux')).toBe(false)
    expect(windowOpacitySupportMessage('linux')).toContain('Linux')
  })
})
