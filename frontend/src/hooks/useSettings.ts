import { useState, useCallback, useEffect, useRef } from 'react'
import { SettingService, KeyService, SyncService, TerminalService, FontService } from '@/lib/wails'
import { useAppStore } from '@/store/appStore'
import { logger } from '@/lib/logger'
import { KeyType } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { Dialogs } from '@wailsio/runtime'
import { toast } from '@/components/ui/toast'
import type { Setting, SettingInput } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { applyUIFont, clampUIFontSize, DEFAULT_UI_FONT_FAMILY, DEFAULT_UI_FONT_SIZE, normalizeUIFontFamily } from '@/lib/uiFont'

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
  uiFontSize: number
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

const DEFAULT_THEME: TerminalTheme = {
  background: '#0d1117', foreground: '#c9d1d9', cursorColor: '#c9d1d9',
  cursorStyle: 'bar', fontFamily: '"JetBrains Mono", "Cascadia Code", monospace', fontSize: 14,
  ansi: ['#000000', '#cd0000', '#00cd00', '#cdcd00', '#0000ee', '#cd00cd', '#00cdcd', '#e5e5e5',
    '#7f7f7f', '#ff0000', '#00ff00', '#ffff00', '#5c5cff', '#ff00ff', '#00ffff', '#ffffff'],
}

export function useSettings() {
  const [general, setGeneral] = useState<GeneralSettings>({ maxPoolSize: 10, defaultKeepAlive: 60, defaultTermType: 'xterm-256color', uiFontFamily: DEFAULT_UI_FONT_FAMILY, uiFontSize: DEFAULT_UI_FONT_SIZE })
  const [systemFonts, setSystemFonts] = useState<string[]>([])
  const [theme, setTheme] = useState<TerminalTheme>(DEFAULT_THEME)
  const [keys, setKeys] = useState<KeyInfo[]>([])
  const [sync, setSync] = useState<SyncConfig>({ enabled: false, url: '', username: '', password: '' })
  const syncRevision = useRef(0)

  const loadGeneral = useCallback(async () => {
    try {
      logger.debug('loadGeneral')
      const settings = await SettingService.GetMany(['terminal.max_pool_size', 'terminal.default_keep_alive', 'terminal.default_term_type', 'appearance.ui_font_family', 'appearance.ui_font_size'])
      const loaded = {
        maxPoolSize: settingValue(settings, 'terminal.max_pool_size', 10),
        defaultKeepAlive: settingValue(settings, 'terminal.default_keep_alive', 60),
        defaultTermType: settingValue(settings, 'terminal.default_term_type', 'xterm-256color'),
        uiFontFamily: normalizeUIFontFamily(settingValue(settings, 'appearance.ui_font_family', DEFAULT_UI_FONT_FAMILY)),
        uiFontSize: clampUIFontSize(settingValue(settings, 'appearance.ui_font_size', DEFAULT_UI_FONT_SIZE)),
      }
      applyUIFont({ family: loaded.uiFontFamily, size: loaded.uiFontSize })
      setGeneral(loaded)
    } catch (err) {
      logger.debug('loadGeneral error', err)
    }
  }, [])

  const saveGeneral = useCallback(async (settings: GeneralSettings) => {
    const normalized = { ...settings, uiFontFamily: normalizeUIFontFamily(settings.uiFontFamily), uiFontSize: clampUIFontSize(settings.uiFontSize) }
    try {
      logger.debug('saveGeneral', normalized)
      await Promise.all([SettingService.SetMany([
        settingEntry('terminal.max_pool_size', normalized.maxPoolSize), settingEntry('terminal.default_keep_alive', normalized.defaultKeepAlive), settingEntry('terminal.default_term_type', normalized.defaultTermType), settingEntry('appearance.ui_font_family', normalized.uiFontFamily), settingEntry('appearance.ui_font_size', normalized.uiFontSize),
      ]), TerminalService.SetMaxSize(normalized.maxPoolSize)])
      applyUIFont({ family: normalized.uiFontFamily, size: normalized.uiFontSize })
      setGeneral(normalized)
      useAppStore.getState().setMaxPoolSize(normalized.maxPoolSize)
      toast('通用设置已保存', 'success')
    } catch (err) {
      applyUIFont({ family: general.uiFontFamily, size: general.uiFontSize })
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

  const previewUIFont = useCallback((fontFamily: string, fontSize: number) => {
    applyUIFont({ family: fontFamily, size: fontSize })
  }, [])

  const restoreUIFont = useCallback(() => {
    applyUIFont({ family: general.uiFontFamily, size: general.uiFontSize })
  }, [general.uiFontFamily, general.uiFontSize])

  const saveTheme = useCallback(async (t: TerminalTheme) => {
    try {
      logger.debug('saveTheme')
      await SettingService.Set(settingEntry('terminal.theme', t))
      setTheme(t)
      useAppStore.getState().setTerminalTheme({
        background: t.background,
        foreground: t.foreground,
        cursor: t.cursorColor,
        cursorAccent: t.background,
        selectionBackground: '#264f78',
        cursorStyle: t.cursorStyle,
        fontFamily: t.fontFamily,
        fontSize: t.fontSize,
        ansiBlack: t.ansi[0] ?? '#000000',
        ansiRed: t.ansi[1] ?? '#cd0000',
        ansiGreen: t.ansi[2] ?? '#00cd00',
        ansiYellow: t.ansi[3] ?? '#cdcd00',
        ansiBlue: t.ansi[4] ?? '#0000ee',
        ansiMagenta: t.ansi[5] ?? '#cd00cd',
        ansiCyan: t.ansi[6] ?? '#00cdcd',
        ansiWhite: t.ansi[7] ?? '#e5e5e5',
        ansiBrightBlack: t.ansi[8] ?? '#7f7f7f',
        ansiBrightRed: t.ansi[9] ?? '#ff0000',
        ansiBrightGreen: t.ansi[10] ?? '#00ff00',
        ansiBrightYellow: t.ansi[11] ?? '#ffff00',
        ansiBrightBlue: t.ansi[12] ?? '#5c5cff',
        ansiBrightMagenta: t.ansi[13] ?? '#ff00ff',
        ansiBrightCyan: t.ansi[14] ?? '#00ffff',
        ansiBrightWhite: t.ansi[15] ?? '#ffffff',
      })
    } catch (err) {
      logger.debug('saveTheme error', err)
    }
  }, [])

  const loadTheme = useCallback(async () => {
    try {
      logger.debug('loadTheme')
      const setting = await SettingService.Get('terminal.theme')
      if (setting) {
        const t: TerminalTheme = JSON.parse(setting.value)
        setTheme(t)
        useAppStore.getState().setTerminalTheme({
          background: t.background,
          foreground: t.foreground,
          cursor: t.cursorColor,
          cursorAccent: t.background,
          selectionBackground: '#264f78',
          cursorStyle: t.cursorStyle,
          fontFamily: t.fontFamily,
          fontSize: t.fontSize,
          ansiBlack: t.ansi[0] ?? '#000000',
          ansiRed: t.ansi[1] ?? '#cd0000',
          ansiGreen: t.ansi[2] ?? '#00cd00',
          ansiYellow: t.ansi[3] ?? '#cdcd00',
          ansiBlue: t.ansi[4] ?? '#0000ee',
          ansiMagenta: t.ansi[5] ?? '#cd00cd',
          ansiCyan: t.ansi[6] ?? '#00cdcd',
          ansiWhite: t.ansi[7] ?? '#e5e5e5',
          ansiBrightBlack: t.ansi[8] ?? '#7f7f7f',
          ansiBrightRed: t.ansi[9] ?? '#ff0000',
          ansiBrightGreen: t.ansi[10] ?? '#00ff00',
          ansiBrightYellow: t.ansi[11] ?? '#ffff00',
          ansiBrightBlue: t.ansi[12] ?? '#5c5cff',
          ansiBrightMagenta: t.ansi[13] ?? '#ff00ff',
          ansiBrightCyan: t.ansi[14] ?? '#00ffff',
          ansiBrightWhite: t.ansi[15] ?? '#ffffff',
        })
      }
    } catch (err) {
      logger.debug('loadTheme error', err)
    }
  }, [])

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

  useEffect(() => { loadGeneral(); loadTheme(); listKeys(); loadSync(); loadSystemFonts() }, [loadGeneral, loadTheme, listKeys, loadSync, loadSystemFonts])

  return { general, theme, keys, sync, systemFonts, saveGeneral, previewUIFont, restoreUIFont, saveTheme, listKeys, generateKey, importKey, deleteKey, exportKey, saveSync, exportConfig, importConfig }
}
