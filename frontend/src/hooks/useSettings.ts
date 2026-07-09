import { useState, useCallback, useEffect } from 'react'

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
  background: '#0d1117',
  foreground: '#c9d1d9',
  cursorColor: '#c9d1d9',
  cursorStyle: 'bar',
  fontFamily: '"JetBrains Mono", "Cascadia Code", monospace',
  fontSize: 14,
  ansi: [
    '#000000', '#cd0000', '#00cd00', '#cdcd00',
    '#0000ee', '#cd00cd', '#00cdcd', '#e5e5e5',
    '#7f7f7f', '#ff0000', '#00ff00', '#ffff00',
    '#5c5cff', '#ff00ff', '#00ffff', '#ffffff',
  ],
}

export function useSettings() {
  const [general, setGeneral] = useState<GeneralSettings>({
    maxPoolSize: 10,
    defaultKeepAlive: 60,
    defaultTermType: 'xterm-256color',
  })
  const [theme, setTheme] = useState<TerminalTheme>(DEFAULT_THEME)
  const [keys, setKeys] = useState<KeyInfo[]>([])
  const [sync, setSync] = useState<SyncConfig>({
    enabled: false,
    url: '',
    username: '',
    password: '',
  })

  const loadGeneral = useCallback(() => {
    console.debug('[Wails:SettingsService.GetGeneral]')
    // const result = await Wails.SettingsService.GetGeneral()
    // setGeneral(result)
  }, [])

  const saveGeneral = useCallback(async (settings: GeneralSettings) => {
    console.debug('[Wails:SettingsService.SaveGeneral]', settings)
    // await Wails.SettingsService.SaveGeneral(settings)
    setGeneral(settings)
  }, [])

  const loadTheme = useCallback(() => {
    console.debug('[Wails:SettingsService.GetTheme]')
    // const result = await Wails.SettingsService.GetTheme()
    // setTheme(result)
  }, [])

  const saveTheme = useCallback(async (t: TerminalTheme) => {
    console.debug('[Wails:SettingsService.SaveTheme]', t)
    // await Wails.SettingsService.SaveTheme(t)
    setTheme(t)
  }, [])

  const listKeys = useCallback(async () => {
    console.debug('[Wails:KeyService.ListKeys]')
    // const result = await Wails.KeyService.ListKeys()
    // setKeys(result)
  }, [])

  const generateKey = useCallback(
    async (name: string, type: KeyInfo['type'], bits: number) => {
      console.debug('[Wails:KeyService.GenerateKey]', name, type, bits)
      // const result = await Wails.KeyService.GenerateKey(name, type, bits)
      // setKeys((prev) => [...prev, result])
    },
    [],
  )

  const importKey = useCallback(
    async (name: string, privateKey: string) => {
      console.debug('[Wails:KeyService.ImportKey]', name)
      // const result = await Wails.KeyService.ImportKey(name, privateKey)
      // setKeys((prev) => [...prev, result])
    },
    [],
  )

  const deleteKey = useCallback(async (id: string) => {
    console.debug('[Wails:KeyService.DeleteKey]', id)
    // await Wails.KeyService.DeleteKey(id)
    setKeys((prev) => prev.filter((k) => k.id !== id))
  }, [])

  const exportKey = useCallback(async (id: string) => {
    console.debug('[Wails:KeyService.ExportKey]', id)
    // const result = await Wails.KeyService.ExportKey(id)
    // Trigger file download with result
  }, [])

  const loadSync = useCallback(() => {
    console.debug('[Wails:SettingsService.GetSync]')
    // const result = await Wails.SettingsService.GetSync()
    // setSync(result)
  }, [])

  const saveSync = useCallback(async (config: SyncConfig) => {
    console.debug('[Wails:SettingsService.SaveSync]', config)
    // await Wails.SettingsService.SaveSync(config)
    setSync(config)
  }, [])

  const exportConfig = useCallback(async () => {
    console.debug('[Wails:SettingsService.ExportConfig]')
    // const result = await Wails.SettingsService.ExportConfig()
    // Trigger file save dialog with result
  }, [])

  const importConfig = useCallback(async () => {
    console.debug('[Wails:SettingsService.ImportConfig]')
    // Trigger file open dialog
    // const config = await Wails.SettingsService.ImportConfig()
    // Apply imported config
  }, [])

  useEffect(() => {
    loadGeneral()
    loadTheme()
    listKeys()
    loadSync()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    general,
    theme,
    keys,
    sync,
    saveGeneral,
    saveTheme,
    listKeys,
    generateKey,
    importKey,
    deleteKey,
    exportKey,
    saveSync,
    exportConfig,
    importConfig,
  }
}
