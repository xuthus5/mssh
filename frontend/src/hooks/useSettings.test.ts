import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSettings } from '@/hooks/useSettings'
import { setWailsServices, createLocalServices, resetWailsForTest } from '@/lib/wails'

describe('useSettings', () => {
  beforeEach(() => {
    resetWailsForTest()
    setWailsServices(createLocalServices())
  })

  it('loads default general settings', async () => {
    const { result } = renderHook(() => useSettings())
    await act(async () => {})
    expect(result.current.general.maxPoolSize).toBe(10)
    expect(result.current.general.defaultKeepAlive).toBe(60)
    expect(result.current.general.defaultTermType).toBe('xterm-256color')
  })

  it('saves general settings and updates state', async () => {
    const { result } = renderHook(() => useSettings())
    await act(async () => {
      await result.current.saveGeneral({ maxPoolSize: 32, defaultKeepAlive: 120, defaultTermType: 'xterm' })
    })
    expect(result.current.general.maxPoolSize).toBe(32)
    expect(result.current.general.defaultKeepAlive).toBe(120)
    expect(result.current.general.defaultTermType).toBe('xterm')
  })

  it('saveTheme persists to settings', async () => {
    const { result } = renderHook(() => useSettings())
    const custom = {
      background: '#fff', foreground: '#000', cursorColor: '#f00',
      cursorStyle: 'block' as const, fontFamily: 'monospace', fontSize: 16,
      ansi: Array(16).fill('#000'),
    }
    await act(async () => { await result.current.saveTheme(custom) })
    expect(result.current.theme.background).toBe('#fff')
  })

  it('generates a key and adds to state', async () => {
    const { result } = renderHook(() => useSettings())
    await act(async () => { await result.current.generateKey('my-key', 'ed25519', 256) })
    expect(result.current.keys).toHaveLength(1)
    expect(result.current.keys[0].name).toBe('my-key')
    expect(result.current.keys[0].type).toBe('ed25519')
  })

  it('deletes a key and removes from state', async () => {
    const { result } = renderHook(() => useSettings())
    await act(async () => { await result.current.generateKey('k1', 'rsa', 2048) })
    expect(result.current.keys).toHaveLength(1)

    await act(async () => { await result.current.deleteKey(result.current.keys[0].id) })
    expect(result.current.keys).toHaveLength(0)
  })

  it('imports a key and adds to state', async () => {
    const { result } = renderHook(() => useSettings())
    await act(async () => { await result.current.importKey('imported', '-----BEGIN RSA...') })
    expect(result.current.keys).toHaveLength(1)
    expect(result.current.keys[0].name).toBe('imported')
  })

  it('exports a key returns public key string', async () => {
    const { result } = renderHook(() => useSettings())
    await act(async () => { await result.current.generateKey('ek', 'rsa', 2048) })
    let exported = ''
    await act(async () => {
      const r = await result.current.exportKey(result.current.keys[0].id)
      if (r) exported = r
    })
    expect(exported).toBe('mock-key')
  })

  it('saves sync config', async () => {
    const { result } = renderHook(() => useSettings())
    await act(async () => {
      await result.current.saveSync({ enabled: true, url: 'http://sync.local', username: 'admin', password: 'pass' })
    })
    expect(result.current.sync.enabled).toBe(true)
    expect(result.current.sync.url).toBe('http://sync.local')
  })

  it('handles generateKey error gracefully', async () => {
    const svc = createLocalServices()
    svc.KeyService.Generate = async () => { throw new Error('key gen failed') }
    resetWailsForTest()
    setWailsServices(svc)

    const { result } = renderHook(() => useSettings())
    await act(async () => { await result.current.generateKey('bad', 'rsa', 1024) })
    expect(result.current.keys).toHaveLength(0)
  })
})
