import { useState, useCallback, useEffect } from 'react'
import { SettingService, KeyService, SyncService } from '@/lib/wails'
import { useAppStore } from '@/store/appStore'
import { logger } from '@/lib/logger'
import { KeyType } from '../../bindings/mssh/internal/model/models'

export interface GeneralSettings {
  maxPoolSize: number
  defaultKeepAlive: number
  defaultTermType: string
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
  const [general, setGeneral] = useState<GeneralSettings>({ maxPoolSize: 10, defaultKeepAlive: 60, defaultTermType: 'xterm-256color' })
  const [theme, setTheme] = useState<TerminalTheme>(DEFAULT_THEME)
  const [keys, setKeys] = useState<KeyInfo[]>([])
  const [sync, setSync] = useState<SyncConfig>({ enabled: false, url: '', username: '', password: '' })

  const loadGeneral = useCallback(async () => {
    try {
      logger.debug('loadGeneral')
      const maxPoolSize = await SettingService.GetSetting('max_pool_size')
      const keepAlive = await SettingService.GetSetting('default_keep_alive')
      const termType = await SettingService.GetSetting('default_term_type')
      setGeneral({
        maxPoolSize: maxPoolSize ? Number(maxPoolSize) : 10,
        defaultKeepAlive: keepAlive ? Number(keepAlive) : 60,
        defaultTermType: termType || 'xterm-256color',
      })
    } catch (err) {
      logger.debug('loadGeneral error', err)
    }
  }, [])

  const saveGeneral = useCallback(async (settings: GeneralSettings) => {
    try {
      logger.debug('saveGeneral', settings)
      await SettingService.SetSetting('max_pool_size', String(settings.maxPoolSize))
      await SettingService.SetSetting('default_keep_alive', String(settings.defaultKeepAlive))
      await SettingService.SetSetting('default_term_type', settings.defaultTermType)
      setGeneral(settings)
    } catch (err) {
      logger.debug('saveGeneral error', err)
    }
  }, [])

  const saveTheme = useCallback(async (t: TerminalTheme) => {
    try {
      logger.debug('saveTheme')
      await SettingService.SetSetting('theme', JSON.stringify(t))
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
      const raw = await SettingService.GetSetting('theme')
      if (raw) {
        const t: TerminalTheme = JSON.parse(raw)
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
      logger.debug('saveSync', { enabled: config.enabled, url: config.url })
      await SettingService.SetSetting('sync_enabled', String(config.enabled))
      await SettingService.SetSetting('sync_url', config.url)
      await SettingService.SetSetting('sync_username', config.username)
      setSync(config)
    } catch (err) {
      logger.debug('saveSync error', err)
    }
  }, [])

  const loadSync = useCallback(async () => {
    try {
      logger.debug('loadSync')
      const enabled = await SettingService.GetSetting('sync_enabled')
      const url = await SettingService.GetSetting('sync_url')
      const username = await SettingService.GetSetting('sync_username')
      setSync({ enabled: enabled === 'true', url: url || '', username: username || '', password: '' })
    } catch (err) {
      logger.debug('loadSync error', err)
    }
  }, [])

  const exportConfig = useCallback(async () => {
    try {
      logger.debug('exportConfig')
      const path = await pickSaveFilePath('mssh-export.json')
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
      const path = await pickOpenFilePath()
      if (path) {
        await SyncService.Import(path)
      }
    } catch (err) {
      logger.debug('importConfig error', err)
    }
  }, [])

  useEffect(() => { loadGeneral(); loadTheme(); listKeys(); loadSync() }, [loadGeneral, loadTheme, listKeys, loadSync])

  return { general, theme, keys, sync, saveGeneral, saveTheme, listKeys, generateKey, importKey, deleteKey, exportKey, saveSync, exportConfig, importConfig }
}

async function pickSaveFilePath(suggestedName: string): Promise<string | null> {
  try {
    const handle = await (window as unknown as { showSaveFilePicker?: (opts: { suggestedName: string }) => Promise<FileSystemFileHandle> }).showSaveFilePicker?.({ suggestedName })
    if (handle) {
      return handle.name
    }
  } catch {
    // Fallback to prompt if API unsupported or user cancelled
  }
  const name = prompt('输入保存文件名:', suggestedName)
  return name ?? null
}

async function pickOpenFilePath(): Promise<string | null> {
  try {
    const [handle] = await (window as unknown as { showOpenFilePicker?: () => Promise<FileSystemFileHandle[]> }).showOpenFilePicker?.() ?? [{ name: null }]
    if (handle?.name) {
      return handle.name
    }
  } catch {
    // Fallback to prompt if API unsupported or user cancelled
  }
  const name = prompt('输入导入文件名:', 'mssh-import.json')
  return name ?? null
}
