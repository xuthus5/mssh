import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSettings } from '@/hooks/useSettings'
import { __registerHandler, __clearHandlers } from '@/test/__mocks__/wails-runtime'

let _counter = 0
function nextId() { return ++_counter }

describe('useSettings', () => {
  let _settings: Record<string, string>

  beforeEach(() => {
    __clearHandlers()
    _settings = {}
    _counter = 0

    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.GetSetting', async (key: string) => {
      return _settings[key] ?? ''
    })
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.SetSetting', async (key: string, value: string) => {
      _settings[key] = value
    })
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.Get', async (key: string) => _settings[key] === undefined ? null : ({ key, namespace: key.split('.')[0], value: _settings[key], value_type: 'string', version: 1, updated_at: '' }))
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.GetMany', async (keys: string[]) => Object.fromEntries(keys.filter((key) => _settings[key] !== undefined).map((key) => [key, { key, namespace: key.split('.')[0], value: _settings[key], value_type: 'string', version: 1, updated_at: '' }])))
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.Set', async (setting: any) => { _settings[setting.key] = setting.value })
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.SetMany', async (settings: any[]) => { settings.forEach((setting) => { _settings[setting.key] = setting.value }) })
    __registerHandler('github.com/xuthus5/mssh/internal/service.KeyService.List', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.TerminalService.SetMaxSize', async () => {})
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
    __registerHandler('github.com/xuthus5/mssh/internal/service.KeyService.Generate', async (name: string, keyType: string, bits: number) => ({
      id: nextId(), name, type: keyType, public_key: 'mock-pub', created_at: new Date().toISOString(),
    }))

    const { result } = renderHook(() => useSettings())
    await act(async () => { await result.current.generateKey('my-key', 'ed25519', 256) })
    expect(result.current.keys).toHaveLength(1)
    expect(result.current.keys[0].name).toBe('my-key')
    expect(result.current.keys[0].type).toBe('ed25519')
  })

  it('deletes a key and removes from state', async () => {
    __registerHandler('github.com/xuthus5/mssh/internal/service.KeyService.Generate', async (name: string, keyType: string, bits: number) => ({
      id: nextId(), name, type: keyType, public_key: 'mock-pub', created_at: new Date().toISOString(),
    }))
    __registerHandler('github.com/xuthus5/mssh/internal/service.KeyService.Delete', async () => {})

    const { result } = renderHook(() => useSettings())
    await act(async () => { await result.current.generateKey('k1', 'rsa', 2048) })
    expect(result.current.keys).toHaveLength(1)

    await act(async () => { await result.current.deleteKey(result.current.keys[0].id) })
    expect(result.current.keys).toHaveLength(0)
  })

  it('imports a key and adds to state', async () => {
    __registerHandler('github.com/xuthus5/mssh/internal/service.KeyService.Import', async (name: string) => ({
      id: nextId(), name, type: 'rsa', public_key: 'mock-pub', created_at: new Date().toISOString(),
    }))

    const { result } = renderHook(() => useSettings())
    await act(async () => { await result.current.importKey('imported', '-----BEGIN RSA...') })
    expect(result.current.keys).toHaveLength(1)
    expect(result.current.keys[0].name).toBe('imported')
  })

  it('exports a key returns public key string', async () => {
    __registerHandler('github.com/xuthus5/mssh/internal/service.KeyService.Generate', async (name: string, keyType: string, bits: number) => ({
      id: nextId(), name, type: keyType, public_key: 'mock-pub', created_at: new Date().toISOString(),
    }))
    __registerHandler('github.com/xuthus5/mssh/internal/service.KeyService.ExportPublicKey', async () => 'mock-key')

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
    __registerHandler('github.com/xuthus5/mssh/internal/service.KeyService.Generate', async () => { throw new Error('key gen failed') })

    const { result } = renderHook(() => useSettings())
    await act(async () => { await result.current.generateKey('bad', 'rsa', 1024) })
    expect(result.current.keys).toHaveLength(0)
  })
})
