import { useState, useCallback, useEffect } from 'react'
import { getWails } from '@/lib/wails'

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
      const wails = getWails()
      console.log('[useSettings] loadGeneral')
      const maxPoolSize = await wails.SettingsService.GetSetting('max_pool_size')
      const keepAlive = await wails.SettingsService.GetSetting('default_keep_alive')
      const termType = await wails.SettingsService.GetSetting('default_term_type')
      setGeneral({
        maxPoolSize: maxPoolSize ? Number(maxPoolSize) : 10,
        defaultKeepAlive: keepAlive ? Number(keepAlive) : 60,
        defaultTermType: termType || 'xterm-256color',
      })
    } catch (err) {
      console.log('[useSettings] loadGeneral error', err)
    }
  }, [])

  const saveGeneral = useCallback(async (settings: GeneralSettings) => {
    try {
      const wails = getWails()
      console.log('[useSettings] saveGeneral', settings)
      await wails.SettingsService.SetSetting('max_pool_size', String(settings.maxPoolSize))
      await wails.SettingsService.SetSetting('default_keep_alive', String(settings.defaultKeepAlive))
      await wails.SettingsService.SetSetting('default_term_type', settings.defaultTermType)
      setGeneral(settings)
    } catch (err) {
      console.log('[useSettings] saveGeneral error', err)
    }
  }, [])

  const saveTheme = useCallback(async (t: TerminalTheme) => {
    try {
      const wails = getWails()
      console.log('[useSettings] saveTheme')
      await wails.SettingsService.SetSetting('theme', JSON.stringify(t))
      setTheme(t)
    } catch (err) {
      console.log('[useSettings] saveTheme error', err)
    }
  }, [])

  const loadTheme = useCallback(async () => {
    try {
      const wails = getWails()
      console.log('[useSettings] loadTheme')
      const raw = await wails.SettingsService.GetSetting('theme')
      if (raw) setTheme(JSON.parse(raw))
    } catch (err) {
      console.log('[useSettings] loadTheme error', err)
    }
  }, [])

  const listKeys = useCallback(async () => {
    try {
      const wails = getWails()
      console.log('[useSettings] listKeys')
      const result = await wails.KeyService.List()
      setKeys(result.map((k) => ({ id: String(k.id), name: k.name, type: k.type, bits: 0, publicKey: k.public_key, createdAt: k.created_at })))
    } catch (err) {
      console.log('[useSettings] listKeys error', err)
    }
  }, [])

  const generateKey = useCallback(async (name: string, type: KeyInfo['type'], bits: number) => {
    try {
      const wails = getWails()
      console.log('[useSettings] generateKey', { name, type, bits })
      const result = await wails.KeyService.Generate(name, type, bits)
      setKeys((prev) => [...prev, { id: String(result.id), name: result.name, type: result.type, bits, publicKey: result.public_key, createdAt: result.created_at }])
    } catch (err) {
      console.log('[useSettings] generateKey error', err)
    }
  }, [])

  const importKey = useCallback(async (name: string, privateKey: string) => {
    try {
      const wails = getWails()
      console.log('[useSettings] importKey', { name })
      const result = await wails.KeyService.Import(name, privateKey)
      setKeys((prev) => [...prev, { id: String(result.id), name: result.name, type: result.type, bits: 0, publicKey: result.public_key, createdAt: result.created_at }])
    } catch (err) {
      console.log('[useSettings] importKey error', err)
    }
  }, [])

  const deleteKey = useCallback(async (id: string) => {
    try {
      const wails = getWails()
      console.log('[useSettings] deleteKey', id)
      await wails.KeyService.Delete(Number(id))
      setKeys((prev) => prev.filter((k) => k.id !== id))
    } catch (err) {
      console.log('[useSettings] deleteKey error', err)
    }
  }, [])

  const exportKey = useCallback(async (id: string) => {
    try {
      const wails = getWails()
      console.log('[useSettings] exportKey', id)
      const result = await wails.KeyService.ExportPublicKey(Number(id))
      return result
    } catch (err) {
      console.log('[useSettings] exportKey error', err)
    }
  }, [])

  const saveSync = useCallback(async (config: SyncConfig) => {
    try {
      const wails = getWails()
      console.log('[useSettings] saveSync', { enabled: config.enabled, url: config.url })
      await wails.SettingsService.SetSetting('sync_enabled', String(config.enabled))
      await wails.SettingsService.SetSetting('sync_url', config.url)
      await wails.SettingsService.SetSetting('sync_username', config.username)
      setSync(config)
    } catch (err) {
      console.log('[useSettings] saveSync error', err)
    }
  }, [])

  const loadSync = useCallback(async () => {
    try {
      const wails = getWails()
      console.log('[useSettings] loadSync')
      const enabled = await wails.SettingsService.GetSetting('sync_enabled')
      const url = await wails.SettingsService.GetSetting('sync_url')
      const username = await wails.SettingsService.GetSetting('sync_username')
      setSync({ enabled: enabled === 'true', url: url || '', username: username || '', password: '' })
    } catch (err) {
      console.log('[useSettings] loadSync error', err)
    }
  }, [])

  const exportConfig = useCallback(async () => {
    try {
      const wails = getWails()
      console.log('[useSettings] exportConfig')
      await wails.SyncService.Export('/tmp/mssh-export.json')
    } catch (err) {
      console.log('[useSettings] exportConfig error', err)
    }
  }, [])

  const importConfig = useCallback(async () => {
    try {
      const wails = getWails()
      console.log('[useSettings] importConfig')
      await wails.SyncService.Import('/tmp/mssh-import.json')
    } catch (err) {
      console.log('[useSettings] importConfig error', err)
    }
  }, [])

  useEffect(() => { loadGeneral(); loadTheme(); listKeys(); loadSync() }, [loadGeneral, loadTheme, listKeys, loadSync])

  return { general, theme, keys, sync, saveGeneral, saveTheme, listKeys, generateKey, importKey, deleteKey, exportKey, saveSync, exportConfig, importConfig }
}
