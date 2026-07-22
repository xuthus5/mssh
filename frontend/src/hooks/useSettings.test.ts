import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { Dialogs } from '@wailsio/runtime'
import { useSettings, type KeyImportFile, type KeyMaterial } from '@/hooks/useSettings'
import { DEFAULT_TERMINAL_BEHAVIOR, useTerminalBehaviorStore } from '@/store/terminalBehaviorStore'
import { __registerHandler, __clearHandlers } from '@/test/__mocks__/wails-runtime'

let _counter = 0
function nextId() { return ++_counter }

describe('useSettings', () => {
  let _settings: Record<string, string>
  let writtenSettings: any[]

  beforeEach(() => {
    vi.restoreAllMocks()
    __clearHandlers()
    _settings = {}
    _counter = 0
    writtenSettings = []
    useTerminalBehaviorStore.setState(DEFAULT_TERMINAL_BEHAVIOR)
    document.documentElement.style.removeProperty('--app-font-family')
    document.documentElement.style.removeProperty('--app-font-size')

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
    expect(result.current.general.rightClickAction).toBe('menu')
    expect(result.current.general.copyOnSelect).toBe(false)
    expect(result.current.general.scrollbackLines).toBe(10000)
    expect(result.current.general.closeButtonAction).toBe('tray')
    expect(result.current.systemFonts).toEqual(['Arial', 'Segoe UI'])
  })

  it('saves general settings and updates state', async () => {
    const { result } = renderHook(() => useSettings())
    await act(async () => {
      await result.current.saveGeneral({ maxPoolSize: 32, defaultKeepAlive: 120, defaultTermType: 'xterm', uiFontFamily: 'Segoe UI', uiFontFallbackFamily: 'Microsoft YaHei', uiFontSize: 16, rightClickAction: 'paste', copyOnSelect: true, scrollbackLines: 5000, autoReconnect: false, restoreTabsOnStartup: true, renderer: 'dom', historyPredict: false, closeButtonAction: 'exit', logDir: '', logRetentionDays: 30, proxyMode: 'system', proxyURL: '', proxyNoProxy: '', proxyUsername: '', proxyPassword: '', language: 'zh-CN' })
    })
    expect(result.current.general.maxPoolSize).toBe(32)
    expect(result.current.general.defaultKeepAlive).toBe(120)
    expect(result.current.general.defaultTermType).toBe('xterm')
    expect(result.current.general.uiFontFamily).toBe('Segoe UI')
    expect(result.current.general.uiFontFallbackFamily).toBe('Microsoft YaHei')
    expect(result.current.general.uiFontSize).toBe(16)
    expect(result.current.general.rightClickAction).toBe('paste')
    expect(result.current.general.copyOnSelect).toBe(true)
    expect(result.current.general.scrollbackLines).toBe(5000)
    expect(result.current.general.closeButtonAction).toBe('exit')
    expect(writtenSettings).toContainEqual(expect.objectContaining({ key: 'appearance.ui_font_family', value: '"Segoe UI"' }))
    expect(writtenSettings).toContainEqual(expect.objectContaining({ key: 'appearance.ui_font_fallback_family', value: '"Microsoft YaHei"' }))
    expect(writtenSettings).toContainEqual(expect.objectContaining({ key: 'appearance.ui_font_size', value: '16' }))
    expect(writtenSettings).toContainEqual(expect.objectContaining({ key: 'terminal.right_click_action', value: '"paste"' }))
    expect(writtenSettings).toContainEqual(expect.objectContaining({ key: 'terminal.copy_on_select', value: 'true' }))
    expect(writtenSettings).toContainEqual(expect.objectContaining({ key: 'terminal.scrollback_lines', value: '5000' }))
    expect(writtenSettings).toContainEqual(expect.objectContaining({ key: 'application.close_button_action', value: '"exit"' }))
    expect(useTerminalBehaviorStore.getState()).toMatchObject({ rightClickAction: 'paste', copyOnSelect: true, scrollbackLines: 5000 })
    expect(document.documentElement.style.getPropertyValue('--app-font-family')).toBe('"Segoe UI", "Microsoft YaHei", sans-serif')
    expect(writtenSettings).not.toContainEqual(expect.objectContaining({ updated_at: expect.anything() }))
  })

  it('loads and applies persisted interface font settings', async () => {
    _settings['appearance.ui_font_family'] = '"Arial"'
    _settings['appearance.ui_font_fallback_family'] = '"Segoe UI"'
    _settings['appearance.ui_font_size'] = '18'
    _settings['terminal.right_click_action'] = '"paste"'
    _settings['terminal.copy_on_select'] = 'true'
    _settings['application.close_button_action'] = '"exit"'

    const { result } = renderHook(() => useSettings())
    await act(async () => {})

    expect(result.current.general.uiFontFamily).toBe('Arial')
    expect(result.current.general.uiFontFallbackFamily).toBe('Segoe UI')
    expect(result.current.general.uiFontSize).toBe(18)
    expect(result.current.general.rightClickAction).toBe('paste')
    expect(result.current.general.copyOnSelect).toBe(true)
    expect(result.current.general.closeButtonAction).toBe('exit')
    expect(useTerminalBehaviorStore.getState()).toMatchObject({ rightClickAction: 'paste', copyOnSelect: true })
    expect(document.documentElement.style.getPropertyValue('--app-font-family')).toBe('"Arial", "Segoe UI", sans-serif')
    expect(document.documentElement.style.getPropertyValue('--app-font-size')).toBe('18px')
  })

  it('does not publish a partial load when an existing value has invalid JSON', async () => {
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.GetMany', async (keys: string[]) => {
      if (!keys.includes('terminal.max_pool_size')) return {}
      return {
        'terminal.max_pool_size': { key: 'terminal.max_pool_size', namespace: 'terminal', value: '42', value_type: 'number', version: 1, updated_at: '' },
        'terminal.default_term_type': { key: 'terminal.default_term_type', namespace: 'terminal', value: '{', value_type: 'string', version: 1, updated_at: '' },
      }
    })

    const { result } = renderHook(() => useSettings())
    await act(async () => {})

    expect(result.current.general.maxPoolSize).toBe(10)
    expect(result.current.general.defaultTermType).toBe('xterm-256color')
  })

  it('preserves saved general settings when an earlier load completes', async () => {
    let resolveInitialLoad: ((settings: Record<string, any>) => void) | undefined
    const staleSettings = {
      'terminal.max_pool_size': { key: 'terminal.max_pool_size', namespace: 'terminal', value: '5', value_type: 'number', version: 1, updated_at: '' },
      'terminal.right_click_action': { key: 'terminal.right_click_action', namespace: 'terminal', value: '"menu"', value_type: 'string', version: 1, updated_at: '' },
      'terminal.copy_on_select': { key: 'terminal.copy_on_select', namespace: 'terminal', value: 'false', value_type: 'boolean', version: 1, updated_at: '' },
    }
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.GetMany', async (keys: string[]) => {
      if (keys.includes('terminal.right_click_action')) {
        return new Promise((resolve) => { resolveInitialLoad = resolve })
      }
      return {}
    })

    const { result } = renderHook(() => useSettings())
    await act(async () => {})
    const completeInitialLoad = resolveInitialLoad
    if (!completeInitialLoad) throw new Error('initial general load did not start')

    await act(async () => {
      await result.current.saveGeneral({ ...result.current.general, maxPoolSize: 32, rightClickAction: 'paste', copyOnSelect: true })
    })
    await act(async () => { completeInitialLoad(staleSettings) })

    expect(result.current.general).toMatchObject({ maxPoolSize: 32, rightClickAction: 'paste', copyOnSelect: true })
    expect(useTerminalBehaviorStore.getState()).toMatchObject({ rightClickAction: 'paste', copyOnSelect: true })
  })

  it('does not publish terminal behavior when persistence fails', async () => {
    useTerminalBehaviorStore.getState().setSettings({ rightClickAction: 'menu', copyOnSelect: false, scrollbackLines: 10000, autoReconnect: false, restoreTabsOnStartup: true, renderer: 'dom', historyPredict: false })
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

  it('applies an earlier general load after a failed save', async () => {
    const persistedSettings = {
      'terminal.max_pool_size': { key: 'terminal.max_pool_size', namespace: 'terminal', value: '17', value_type: 'number', version: 1, updated_at: '' },
      'terminal.right_click_action': { key: 'terminal.right_click_action', namespace: 'terminal', value: '"paste"', value_type: 'string', version: 1, updated_at: '' },
      'terminal.copy_on_select': { key: 'terminal.copy_on_select', namespace: 'terminal', value: 'true', value_type: 'boolean', version: 1, updated_at: '' },
    }
    let resolveInitialLoad: ((settings: typeof persistedSettings) => void) | undefined
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.GetMany', async (keys: string[]) => {
      if (keys.includes('terminal.right_click_action')) {
        return new Promise<typeof persistedSettings>((resolve) => { resolveInitialLoad = resolve })
      }
      return {}
    })
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.SetMany', async () => { throw new Error('db failed') })

    const { result } = renderHook(() => useSettings())
    await act(async () => {})
    const completeInitialLoad = resolveInitialLoad
    if (!completeInitialLoad) throw new Error('initial general load did not start')

    await act(async () => {
      await expect(result.current.saveGeneral({ ...result.current.general, maxPoolSize: 44 })).rejects.toThrow('db failed')
    })
    await act(async () => { completeInitialLoad(persistedSettings) })

    expect(result.current.general).toMatchObject({ maxPoolSize: 17, rightClickAction: 'paste', copyOnSelect: true })
    expect(useTerminalBehaviorStore.getState()).toMatchObject({ rightClickAction: 'paste', copyOnSelect: true })
  })

  it('generates a key and adds to state', async () => {
    __registerHandler('github.com/xuthus5/mssh/internal/service.KeyService.Generate', async (name: string, keyType: string, bits: number) => ({
      id: nextId(), name, type: keyType, private_key: 'mock-private', public_key: 'mock-pub', created_at: new Date().toISOString(),
    }))

    const { result } = renderHook(() => useSettings())
    let generated: KeyMaterial | undefined
    await act(async () => { generated = await result.current.generateKey('my-key', 'ed25519', 256) })
    expect(result.current.keys).toHaveLength(1)
    expect(result.current.keys[0].name).toBe('my-key')
    expect(result.current.keys[0].type).toBe('ed25519')
    expect(generated).toMatchObject({ privateKey: 'mock-private', publicKey: 'mock-pub' })
  })

  it('deletes a key and removes from state', async () => {
    __registerHandler('github.com/xuthus5/mssh/internal/service.KeyService.Generate', async (name: string, keyType: string, bits: number) => ({
      id: nextId(), name, type: keyType, private_key: 'mock-private', public_key: 'mock-pub', created_at: new Date().toISOString(),
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
      id: nextId(), name, type: keyType, private_key: 'mock-private', public_key: 'mock-pub', created_at: new Date().toISOString(),
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


  it('loads, updates, and replaces explicit key material without storing private data in the list', async () => {
    const createdAt = new Date().toISOString()
    __registerHandler('github.com/xuthus5/mssh/internal/service.KeyService.List', async () => [{ id: 7, name: 'before', type: 'ed25519', public_key: 'ssh-ed25519 AAAA', created_at: createdAt }])
    __registerHandler('github.com/xuthus5/mssh/internal/service.KeyService.GetMaterial', async () => ({ id: 7, name: 'before', type: 'ed25519', private_key: 'private', public_key: 'ssh-ed25519 AAAA', created_at: createdAt }))
    __registerHandler('github.com/xuthus5/mssh/internal/service.KeyService.Update', async (input) => ({ id: input.id, name: input.name, type: 'ed25519', private_key: input.private_key, public_key: input.public_key, created_at: createdAt }))
    const { result } = renderHook(() => useSettings())
    await act(async () => {})

    let loaded: KeyMaterial | undefined
    await act(async () => { loaded = await result.current.loadKeyMaterial('7') })
    expect(loaded).toMatchObject({ id: '7', privateKey: 'private' })
    if (!loaded) throw new Error('key material was not loaded')
    const loadedMaterial = loaded
    await act(async () => { await result.current.updateKey({ ...loadedMaterial, name: 'after' }) })
    expect(result.current.keys[0]).toMatchObject({ id: '7', name: 'after', publicKey: 'ssh-ed25519 AAAA' })
    expect(result.current.keys[0]).not.toHaveProperty('privateKey')
  })

  it('opens key import in the user SSH directory and reads the selected file', async () => {
    __registerHandler('github.com/xuthus5/mssh/internal/service.KeyService.SelectImportFile', async () => ({ name: 'id_ed25519', private_key: 'private-content' }))
    const { result } = renderHook(() => useSettings())

    let selected: KeyImportFile | undefined
    await act(async () => { selected = await result.current.selectKeyImportFile() })

    expect(selected).toEqual({ name: 'id_ed25519', privateKey: 'private-content' })
  })

  it('handles generateKey error gracefully', async () => {
    __registerHandler('github.com/xuthus5/mssh/internal/service.KeyService.Generate', async () => { throw new Error('key gen failed') })

    const { result } = renderHook(() => useSettings())
    await act(async () => { await result.current.generateKey('bad', 'rsa', 1024) })
    expect(result.current.keys).toHaveLength(0)
  })

  it('exports and imports configuration through native dialogs', async () => {
    const saveFile = vi.spyOn(Dialogs, 'SaveFile').mockResolvedValue('/tmp/mssh-export.json')
    const openFile = vi.spyOn(Dialogs, 'OpenFile').mockResolvedValue(['/tmp/mssh-import.json'])
    const exportConfig = vi.fn(async () => {})
    const importConfig = vi.fn(async () => {})
    __registerHandler('github.com/xuthus5/mssh/internal/service.SyncService.Export', exportConfig)
    __registerHandler('github.com/xuthus5/mssh/internal/service.SyncService.Import', importConfig)
    const { result } = renderHook(() => useSettings())

    await act(async () => { await result.current.exportConfig(); await result.current.importConfig() })

    expect(saveFile).toHaveBeenCalledOnce()
    expect(openFile).toHaveBeenCalledOnce()
    expect(exportConfig).toHaveBeenCalledWith('/tmp/mssh-export.json')
    expect(importConfig).toHaveBeenCalledWith('/tmp/mssh-import.json')
  })

  it('handles auxiliary service failures without leaking rejections', async () => {
    __registerHandler('github.com/xuthus5/mssh/internal/service.KeyService.List', async () => { throw new Error('list failed') })
    __registerHandler('github.com/xuthus5/mssh/internal/service.FontService.List', async () => { throw new Error('font failed') })
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.GetMany', async () => { throw new Error('load failed') })
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.SetMany', async () => { throw new Error('save failed') })
    __registerHandler('github.com/xuthus5/mssh/internal/service.KeyService.Import', async () => { throw new Error('import failed') })
    __registerHandler('github.com/xuthus5/mssh/internal/service.KeyService.Delete', async () => { throw new Error('delete failed') })
    __registerHandler('github.com/xuthus5/mssh/internal/service.KeyService.ExportPublicKey', async () => { throw new Error('export failed') })
    vi.spyOn(Dialogs, 'SaveFile').mockRejectedValue(new Error('dialog failed'))
    vi.spyOn(Dialogs, 'OpenFile').mockRejectedValue(new Error('dialog failed'))
    const { result } = renderHook(() => useSettings())
    await act(async () => {})

    await act(async () => {
      await result.current.importKey('bad', 'bad')
      await result.current.deleteKey('1')
      await result.current.exportKey('1')
      await result.current.exportConfig()
      await result.current.importConfig()
    })

    expect(result.current.keys).toEqual([])
    expect(result.current.systemFonts).toEqual(['sans-serif'])
  })
})
