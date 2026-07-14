import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSettings } from '@/hooks/useSettings'
import { DEFAULT_TERMINAL_BEHAVIOR, useTerminalBehaviorStore } from '@/store/terminalBehaviorStore'
import { __registerHandler, __clearHandlers } from '@/test/__mocks__/wails-runtime'

let _counter = 0
function nextId() { return ++_counter }

describe('useSettings', () => {
  let _settings: Record<string, string>
  let writtenSettings: any[]

  beforeEach(() => {
    __clearHandlers()
    _settings = {}
    _counter = 0
    writtenSettings = []
    useTerminalBehaviorStore.setState(DEFAULT_TERMINAL_BEHAVIOR)
    document.documentElement.style.removeProperty('--app-font-family')
    document.documentElement.style.removeProperty('--app-font-size')
    document.documentElement.style.removeProperty('--app-opacity')

    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.GetSetting', async (key: string) => {
      return _settings[key] ?? ''
    })
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.SetSetting', async (key: string, value: string) => {
      _settings[key] = value
    })
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.Get', async (key: string) => _settings[key] === undefined ? null : ({ key, namespace: key.split('.')[0], value: _settings[key], value_type: 'string', version: 1, updated_at: '' }))
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.GetMany', async (keys: string[]) => Object.fromEntries(keys.filter((key) => _settings[key] !== undefined).map((key) => [key, { key, namespace: key.split('.')[0], value: _settings[key], value_type: 'string', version: 1, updated_at: '' }])))
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.Set', async (setting: any) => { writtenSettings.push(setting); _settings[setting.key] = setting.value })
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.SetMany', async (settings: any[]) => { writtenSettings.push(...settings); settings.forEach((setting) => { _settings[setting.key] = setting.value }) })
    __registerHandler('github.com/xuthus5/mssh/internal/service.KeyService.List', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.TerminalService.SetMaxSize', async () => {})
    __registerHandler('github.com/xuthus5/mssh/internal/service.FontService.List', async () => ['Arial', 'Segoe UI'])
  })

  it('loads default general settings', async () => {
    const { result } = renderHook(() => useSettings())
    await act(async () => {})
    expect(result.current.general.maxPoolSize).toBe(10)
    expect(result.current.general.defaultKeepAlive).toBe(60)
    expect(result.current.general.defaultTermType).toBe('xterm-256color')
    expect(result.current.general.uiFontFamily).toBe('Geist Variable')
    expect(result.current.general.uiFontFallbackFamily).toBe('sans-serif')
    expect(result.current.general.uiFontSize).toBe(14)
    expect(result.current.general.windowOpacity).toBe(100)
    expect(result.current.general.rightClickAction).toBe('menu')
    expect(result.current.general.copyOnSelect).toBe(false)
    expect(result.current.systemFonts).toEqual(['Arial', 'Segoe UI'])
  })

  it('saves general settings and updates state', async () => {
    const { result } = renderHook(() => useSettings())
    await act(async () => {
      await result.current.saveGeneral({ maxPoolSize: 32, defaultKeepAlive: 120, defaultTermType: 'xterm', uiFontFamily: 'Segoe UI', uiFontFallbackFamily: 'Microsoft YaHei', uiFontSize: 16, windowOpacity: 82, rightClickAction: 'paste', copyOnSelect: true })
    })
    expect(result.current.general.maxPoolSize).toBe(32)
    expect(result.current.general.defaultKeepAlive).toBe(120)
    expect(result.current.general.defaultTermType).toBe('xterm')
    expect(result.current.general.uiFontFamily).toBe('Segoe UI')
    expect(result.current.general.uiFontFallbackFamily).toBe('Microsoft YaHei')
    expect(result.current.general.uiFontSize).toBe(16)
    expect(result.current.general.windowOpacity).toBe(82)
    expect(result.current.general.rightClickAction).toBe('paste')
    expect(result.current.general.copyOnSelect).toBe(true)
    expect(writtenSettings).toContainEqual(expect.objectContaining({ key: 'appearance.ui_font_family', value: '"Segoe UI"' }))
    expect(writtenSettings).toContainEqual(expect.objectContaining({ key: 'appearance.ui_font_fallback_family', value: '"Microsoft YaHei"' }))
    expect(writtenSettings).toContainEqual(expect.objectContaining({ key: 'appearance.ui_font_size', value: '16' }))
    expect(writtenSettings).toContainEqual(expect.objectContaining({ key: 'appearance.window_opacity', value: '82' }))
    expect(writtenSettings).toContainEqual(expect.objectContaining({ key: 'terminal.right_click_action', value: '"paste"' }))
    expect(writtenSettings).toContainEqual(expect.objectContaining({ key: 'terminal.copy_on_select', value: 'true' }))
    expect(useTerminalBehaviorStore.getState()).toMatchObject({ rightClickAction: 'paste', copyOnSelect: true })
    expect(document.documentElement.style.getPropertyValue('--app-font-family')).toBe('"Segoe UI", "Microsoft YaHei", sans-serif')
    expect(document.documentElement.style.getPropertyValue('--app-opacity')).toBe('0.82')
    expect(writtenSettings).not.toContainEqual(expect.objectContaining({ updated_at: expect.anything() }))
  })

  it('loads and applies persisted interface font settings', async () => {
    _settings['appearance.ui_font_family'] = '"Arial"'
    _settings['appearance.ui_font_fallback_family'] = '"Segoe UI"'
    _settings['appearance.ui_font_size'] = '18'
    _settings['appearance.window_opacity'] = '76'
    _settings['terminal.right_click_action'] = '"paste"'
    _settings['terminal.copy_on_select'] = 'true'

    const { result } = renderHook(() => useSettings())
    await act(async () => {})

    expect(result.current.general.uiFontFamily).toBe('Arial')
    expect(result.current.general.uiFontFallbackFamily).toBe('Segoe UI')
    expect(result.current.general.uiFontSize).toBe(18)
    expect(result.current.general.windowOpacity).toBe(76)
    expect(result.current.general.rightClickAction).toBe('paste')
    expect(result.current.general.copyOnSelect).toBe(true)
    expect(useTerminalBehaviorStore.getState()).toMatchObject({ rightClickAction: 'paste', copyOnSelect: true })
    expect(document.documentElement.style.getPropertyValue('--app-font-family')).toBe('"Arial", "Segoe UI", sans-serif')
    expect(document.documentElement.style.getPropertyValue('--app-font-size')).toBe('18px')
    expect(document.documentElement.style.getPropertyValue('--app-opacity')).toBe('0.76')
  })

  it('does not publish terminal behavior when persistence fails', async () => {
    useTerminalBehaviorStore.getState().setSettings({ rightClickAction: 'menu', copyOnSelect: false })
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.SetMany', async () => { throw new Error('db failed') })
    const { result } = renderHook(() => useSettings())
    await act(async () => {})

    let saveError: unknown
    await act(async () => {
      try {
        await result.current.saveGeneral({ ...result.current.general, rightClickAction: 'paste', copyOnSelect: true })
      } catch (error) {
        saveError = error
      }
    })
    expect(saveError).toEqual(expect.objectContaining({ message: 'db failed' }))
    expect(useTerminalBehaviorStore.getState()).toMatchObject({ rightClickAction: 'menu', copyOnSelect: false })
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
