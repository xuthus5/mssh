import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getClipboard } from '@/lib/clipboard'

describe('clipboard adapter', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: vi.fn(async () => 'browser text'), writeText: vi.fn(async () => {}) },
    })
  })

  it('falls back to the browser clipboard when native Wails clipboard is unavailable', async () => {
    const clipboard = getClipboard()
    expect(await clipboard.readText()).toBe('browser text')
    await clipboard.writeText('payload')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('payload')
  })

  it('uses native clipboard results when the Wails runtime provides them', async () => {
    const native = await import('@wailsio/runtime')
    vi.spyOn(native.Clipboard, 'Text').mockResolvedValueOnce('native text')
    vi.spyOn(native.Clipboard, 'SetText').mockResolvedValueOnce()
    const clipboard = getClipboard()

    expect(await clipboard.readText()).toBe('native text')
    await clipboard.writeText('native payload')
    expect(native.Clipboard.SetText).toHaveBeenCalledWith('native payload')
  })
})
