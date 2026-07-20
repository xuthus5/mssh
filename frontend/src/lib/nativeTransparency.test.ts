import { beforeEach, describe, expect, it } from 'vitest'
import { applyNativeTransparencyStatus } from '@/lib/nativeTransparency'

describe('nativeTransparency', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/')
    delete document.documentElement.dataset.nativeTransparency
  })

  it('activates transparent web content only for an active main window', () => {
    applyNativeTransparencyStatus({ supported: true, active: true, platform: 'windows', reason: '', requires_restart: true })
    expect(document.documentElement.dataset.nativeTransparency).toBe('active')
  })

  it('keeps the settings window opaque', () => {
    window.history.replaceState({}, '', '/?window=settings')
    applyNativeTransparencyStatus({ supported: true, active: true, platform: 'windows', reason: '', requires_restart: true })
    expect(document.documentElement.dataset.nativeTransparency).toBe('inactive')
  })
})
