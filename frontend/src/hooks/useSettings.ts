import { useState, useCallback, useEffect, useRef } from 'react'
import { SettingService, KeyService, SyncService, TerminalService, FontService } from '@/lib/wails'
import { useAppStore } from '@/store/appStore'
import { logger } from '@/lib/logger'
import { KeyType } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { Dialogs } from '@wailsio/runtime'
import { toast } from '@/components/ui/toast'
import type { Setting, SettingInput } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { applyUIFont, clampUIFontSize, DEFAULT_UI_FONT_FALLBACK_FAMILY, DEFAULT_UI_FONT_FAMILY, DEFAULT_UI_FONT_SIZE, normalizeUIFontFallbackFamily, normalizeUIFontFamily } from '@/lib/uiFont'
import { applyWindowOpacity, clampWindowOpacity, DEFAULT_WINDOW_OPACITY } from '@/lib/uiOpacity'
import { normalizeCopyOnSelect, normalizeTerminalRightClickAction, useTerminalBehaviorStore, type TerminalRightClickAction } from '@/store/terminalBehaviorStore'

function settingEntry(key: string, value: unknown): SettingInput {
  const valueType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'object' ? 'object' : typeof value
  return { key, namespace: key.split('.')[0], value: JSON.stringify(value), value_type: valueType, version: 1 }
}

function settingValue<T>(settings: { [_ in string]?: Setting }, key: string, fallback: T): T {
  const raw = settings[key]?.value
  if (!raw) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

export interface GeneralSettings {
  maxPoolSize: number
  defaultKeepAlive: number
  defaultTermType: string
  uiFontFamily: string
  uiFontFallbackFamily: string
  uiFontSize: number
  windowOpacity: number
  rightClickAction: TerminalRightClickAction
  copyOnSelect: boolean
}

export interface TerminalTheme {
  background: string
  foreground: string
  cursorColor: string
  cursorStyle: 'block' | 'underline' | 'bar'
  fontFamily: string
  fontSize: number
  ansi: string[]
}

export interface KeyInfo {
  id: string
  name: string
  type: 'rsa' | 'ed25519' | 'ecdsa'
  bits: number
  publicKey: string
  createdAt: string
}

export interface SyncConfig {
  enabled: boolean
  url: string
  username: string
  password: string
}

export function useSettings() {
  const [general, setGeneral] = useState<GeneralSettings>({ maxPoolSize: 10, defaultKeepAlive: 60, defaultTermType: 'xterm-256color', uiFontFamily: DEFAULT_UI_FONT_FAMILY, uiFontFallbackFamily: DEFAULT_UI_FONT_FALLBACK_FAMILY, uiFontSize: DEFAULT_UI_FONT_SIZE, windowOpacity: DEFAULT_WINDOW_OPACITY, rightClickAction: 'menu', copyOnSelect: false })
  const [systemFonts, setSystemFonts] = useState<string[]>([])
  const [keys, setKeys] = useState<KeyInfo[]>([])
  const [sync, setSync] = useState<SyncConfig>({ enabled: false, url: '', username: '', password: '' })
  const generalRevision = useRef(0)
  const syncRevision = useRef(0)

  const loadGeneral = useCallback(async () => {
    const revision = generalRevision.current
    try {
      logger.debug('loadGeneral')
      const settings = await SettingService.GetMany(['terminal.max_pool_size', 'terminal.default_keep_alive', 'terminal.default_term_type', 'terminal.right_click_action', 'terminal.copy_on_select', 'appearance.ui_font_family', 'appearance.ui_font_fallback_family', 'appearance.ui_font_size', 'appearance.window_opacity'])
      const uiFontFamily = normalizeUIFontFamily(settingValue(settings, 'appearance.ui_font_family', DEFAULT_UI_FONT_FAMILY))
      const behavior = {
        rightClickAction: normalizeTerminalRightClickAction(settingValue(settings, 'terminal.right_click_action', 'menu')),
        copyOnSelect: normalizeCopyOnSelect(settingValue(settings, 'terminal.copy_on_select', false)),
      }
      const loaded = {
        maxPoolSize: settingValue(settings, 'terminal.max_pool_size', 10),
        defaultKeepAlive: settingValue(settings, 'terminal.default_keep_alive', 60),
        defaultTermType: settingValue(settings, 'terminal.default_term_type', 'xterm-256color'),
        uiFontFamily,
        uiFontFallbackFamily: normalizeUIFontFallbackFamily(settingValue(settings, 'appearance.ui_font_fallback_family', DEFAULT_UI_FONT_FALLBACK_FAMILY), uiFontFamily),
        uiFontSize: clampUIFontSize(settingValue(settings, 'appearance.ui_font_size', DEFAULT_UI_FONT_SIZE)),
        windowOpacity: clampWindowOpacity(settingValue(settings, 'appearance.window_opacity', DEFAULT_WINDOW_OPACITY)),
        ...behavior,
      }
      if (revision !== generalRevision.current) return
      applyUIFont({ family: loaded.uiFontFamily, fallbackFamily: loaded.uiFontFallbackFamily, size: loaded.uiFontSize })
      applyWindowOpacity(loaded.windowOpacity)
      useTerminalBehaviorStore.getState().setSettings(behavior)
      setGeneral(loaded)
    } catch (err) {
      logger.debug('loadGeneral error', err)
    }
  }, [])

  const saveGeneral = useCallback(async (settings: GeneralSettings) => {
    const uiFontFamily = normalizeUIFontFamily(settings.uiFontFamily)
    const behavior = {
      rightClickAction: normalizeTerminalRightClickAction(settings.rightClickAction),
      copyOnSelect: normalizeCopyOnSelect(settings.copyOnSelect),
    }
    const normalized = { ...settings, ...behavior, uiFontFamily, uiFontFallbackFamily: normalizeUIFontFallbackFamily(settings.uiFontFallbackFamily, uiFontFamily), uiFontSize: clampUIFontSize(settings.uiFontSize), windowOpacity: clampWindowOpacity(settings.windowOpacity) }
    try {
      logger.debug('saveGeneral', normalized)
      await Promise.all([SettingService.SetMany([
        settingEntry('terminal.max_pool_size', normalized.maxPoolSize), settingEntry('terminal.default_keep_alive', normalized.defaultKeepAlive), settingEntry('terminal.default_term_type', normalized.defaultTermType), settingEntry('terminal.right_click_action', normalized.rightClickAction), settingEntry('terminal.copy_on_select', normalized.copyOnSelect), settingEntry('appearance.ui_font_family', normalized.uiFontFamily), settingEntry('appearance.ui_font_fallback_family', normalized.uiFontFallbackFamily), settingEntry('appearance.ui_font_size', normalized.uiFontSize), settingEntry('appearance.window_opacity', normalized.windowOpacity),
      ]), TerminalService.SetMaxSize(normalized.maxPoolSize)])
      generalRevision.current++
      applyUIFont({ family: normalized.uiFontFamily, fallbackFamily: normalized.uiFontFallbackFamily, size: normalized.uiFontSize })
      applyWindowOpacity(normalized.windowOpacity)
      useTerminalBehaviorStore.getState().setSettings(behavior)
      setGeneral(normalized)
      useAppStore.getState().setMaxPoolSize(normalized.maxPoolSize)
      toast('通用设置已保存', 'success')
    } catch (err) {
      applyUIFont({ family: general.uiFontFamily, fallbackFamily: general.uiFontFallbackFamily, size: general.uiFontSize })
      applyWindowOpacity(general.windowOpacity)
      logger.debug('saveGeneral error', err)
      toast(`保存设置失败: ${err instanceof Error ? err.message : String(err)}`, 'error')
      throw err
    }
  }, [general])

  const loadSystemFonts = useCallback(async () => {
    try {
      setSystemFonts(await FontService.List())
    } catch (err) {
      logger.debug('loadSystemFonts error', err)
      setSystemFonts(['sans-serif'])
    }
  }, [])

  const previewUIFont = useCallback((fontFamily: string, fallbackFamily: string, fontSize: number) => {
    applyUIFont({ family: fontFamily, fallbackFamily, size: fontSize })
  }, [])

  const restoreUIFont = useCallback(() => {
    applyUIFont({ family: general.uiFontFamily, fallbackFamily: general.uiFontFallbackFamily, size: general.uiFontSize })
  }, [general.uiFontFamily, general.uiFontFallbackFamily, general.uiFontSize])

  const previewWindowOpacity = useCallback((opacity: number) => applyWindowOpacity(opacity), [])

  const restoreWindowOpacity = useCallback(() => applyWindowOpacity(general.windowOpacity), [general.windowOpacity])

  const listKeys = useCallback(async () => {
    try {
      logger.debug('listKeys')
      const result = await KeyService.List()
      setKeys((result ?? []).map((k) => ({ id: String(k.id), name: k.name, type: k.type as KeyInfo['type'], bits: 0, publicKey: k.public_key, createdAt: k.created_at })))
    } catch (err) {
      logger.debug('listKeys error', err)
    }
  }, [])

  const generateKey = useCallback(async (name: string, type: KeyInfo['type'], bits: number) => {
    try {
      logger.debug('generateKey', { name, type, bits })
      const keyType = ({ rsa: KeyType.KeyTypeRSA, ed25519: KeyType.KeyTypeED25519, ecdsa: KeyType.KeyTypeECDSA } as const)[type]
      const result = await KeyService.Generate(name, keyType, bits)
      if (result) {
        setKeys((prev) => [...prev, { id: String(result.id), name: result.name, type: ({ [KeyType.KeyTypeRSA]: 'rsa', [KeyType.KeyTypeED25519]: 'ed25519', [KeyType.KeyTypeECDSA]: 'ecdsa' } as Record<string, KeyInfo['type']>)[String(result.type)] ?? 'ed25519', bits, publicKey: result.public_key, createdAt: result.created_at }])
      }
    } catch (err) {
      logger.debug('generateKey error', err)
    }
  }, [])

  const importKey = useCallback(async (name: string, privateKey: string) => {
    try {
      logger.debug('importKey', { name })
      const result = await KeyService.Import(name, privateKey)
      if (result) {
        setKeys((prev) => [...prev, { id: String(result.id), name: result.name, type: ({ [KeyType.KeyTypeRSA]: 'rsa', [KeyType.KeyTypeED25519]: 'ed25519', [KeyType.KeyTypeECDSA]: 'ecdsa' } as Record<string, KeyInfo['type']>)[String(result.type)] ?? 'ed25519', bits: 0, publicKey: result.public_key, createdAt: result.created_at }])
      }
    } catch (err) {
      logger.debug('importKey error', err)
    }
  }, [])

  const deleteKey = useCallback(async (id: string) => {
    try {
      logger.debug('deleteKey', id)
      await KeyService.Delete(Number(id))
      setKeys((prev) => prev.filter((k) => k.id !== id))
    } catch (err) {
      logger.debug('deleteKey error', err)
    }
  }, [])

  const exportKey = useCallback(async (id: string) => {
    try {
      logger.debug('exportKey', id)
      const result = await KeyService.ExportPublicKey(Number(id))
      return result
    } catch (err) {
      logger.debug('exportKey error', err)
    }
  }, [])

  const saveSync = useCallback(async (config: SyncConfig) => {
    try {
      syncRevision.current++
      logger.debug('saveSync', { enabled: config.enabled, url: config.url })
      await SettingService.SetMany([settingEntry('sync.enabled', config.enabled), settingEntry('sync.url', config.url), settingEntry('sync.username', config.username)])
      setSync(config)
    } catch (err) {
      logger.debug('saveSync error', err)
    }
  }, [])

  const loadSync = useCallback(async () => {
    try {
      const revision = syncRevision.current
      logger.debug('loadSync')
      const settings = await SettingService.GetMany(['sync.enabled', 'sync.url', 'sync.username'])
      if (revision === syncRevision.current) setSync({ enabled: settingValue(settings, 'sync.enabled', false), url: settingValue(settings, 'sync.url', ''), username: settingValue(settings, 'sync.username', ''), password: '' })
    } catch (err) {
      logger.debug('loadSync error', err)
    }
  }, [])

  const exportConfig = useCallback(async () => {
    try {
      logger.debug('exportConfig')
      const path = await Dialogs.SaveFile({ Title: '导出 MSSH 配置', Filename: 'mssh-export.json', CanCreateDirectories: true })
      if (path) {
        await SyncService.Export(path)
      }
    } catch (err) {
      logger.debug('exportConfig error', err)
    }
  }, [])

  const importConfig = useCallback(async () => {
    try {
      logger.debug('importConfig')
      const selected = await Dialogs.OpenFile({ Title: '导入 MSSH 配置', CanChooseFiles: true, AllowsMultipleSelection: false, Filters: [{ DisplayName: 'JSON', Pattern: '*.json' }] })
      const path = typeof selected === 'string' ? selected : selected[0]
      if (path) {
        await SyncService.Import(path)
      }
    } catch (err) {
      logger.debug('importConfig error', err)
    }
  }, [])

  useEffect(() => { loadGeneral(); listKeys(); loadSync(); loadSystemFonts() }, [loadGeneral, listKeys, loadSync, loadSystemFonts])

  return { general, keys, sync, systemFonts, saveGeneral, previewUIFont, restoreUIFont, previewWindowOpacity, restoreWindowOpacity, listKeys, generateKey, importKey, deleteKey, exportKey, saveSync, exportConfig, importConfig }
}
