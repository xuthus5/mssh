import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Events } from '@wailsio/runtime'
import { SettingService, TerminalService } from '@/lib/wails'
import { useAppStore } from '@/store/appStore'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import type { Setting, SettingInput } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { applyUIFont, clampUIFontSize, DEFAULT_UI_FONT_FALLBACK_FAMILY, DEFAULT_UI_FONT_FAMILY, DEFAULT_UI_FONT_SIZE, normalizeUIFontFallbackFamily, normalizeUIFontFamily } from '@/lib/uiFont'
import { applyWindowOpacity, clampWindowOpacity, DEFAULT_WINDOW_OPACITY } from '@/lib/uiOpacity'
import { normalizeCopyOnSelect, normalizeTerminalRightClickAction, useTerminalBehaviorStore, type TerminalRightClickAction } from '@/store/terminalBehaviorStore'
import { SETTINGS_GENERAL_CHANGED_EVENT, SETTINGS_GENERAL_PREVIEW_EVENT, SETTINGS_PREVIEW_CANCELLED_EVENT } from '@/lib/settingsWindowEvents'

const generalSettingKeys = [
  'terminal.max_pool_size', 'terminal.default_keep_alive', 'terminal.default_term_type',
  'terminal.right_click_action', 'terminal.copy_on_select', 'appearance.ui_font_family',
  'appearance.ui_font_fallback_family', 'appearance.ui_font_size', 'appearance.window_opacity',
]

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

interface GeneralPreview {
  uiFontFamily?: string
  uiFontFallbackFamily?: string
  uiFontSize?: number
  windowOpacity?: number
}

interface EventEnvelope<T> { data?: T }

const defaultGeneralSettings: GeneralSettings = {
  maxPoolSize: 10, defaultKeepAlive: 60, defaultTermType: 'xterm-256color',
  uiFontFamily: DEFAULT_UI_FONT_FAMILY, uiFontFallbackFamily: DEFAULT_UI_FONT_FALLBACK_FAMILY,
  uiFontSize: DEFAULT_UI_FONT_SIZE, windowOpacity: DEFAULT_WINDOW_OPACITY,
  rightClickAction: 'menu', copyOnSelect: false,
}

export function settingEntry(key: string, value: unknown): SettingInput {
  const valueType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'object' ? 'object' : typeof value
  return { key, namespace: key.split('.')[0], value: JSON.stringify(value), value_type: valueType, version: 1 }
}

function settingValue<T>(settings: { [_ in string]?: Setting }, key: string, fallback: T): T {
  const setting = settings[key]
  if (setting === undefined) return fallback
  return JSON.parse(setting.value) as T
}

function normalizeGeneral(settings: GeneralSettings): GeneralSettings {
  const uiFontFamily = normalizeUIFontFamily(settings.uiFontFamily)
  return {
    ...settings,
    uiFontFamily,
    uiFontFallbackFamily: normalizeUIFontFallbackFamily(settings.uiFontFallbackFamily, uiFontFamily),
    uiFontSize: clampUIFontSize(settings.uiFontSize),
    windowOpacity: clampWindowOpacity(settings.windowOpacity),
    rightClickAction: normalizeTerminalRightClickAction(settings.rightClickAction),
    copyOnSelect: normalizeCopyOnSelect(settings.copyOnSelect),
  }
}

function parseGeneral(settings: { [_ in string]?: Setting }): GeneralSettings {
  const uiFontFamily = normalizeUIFontFamily(settingValue(settings, 'appearance.ui_font_family', DEFAULT_UI_FONT_FAMILY))
  return normalizeGeneral({
    maxPoolSize: settingValue(settings, 'terminal.max_pool_size', 10),
    defaultKeepAlive: settingValue(settings, 'terminal.default_keep_alive', 60),
    defaultTermType: settingValue(settings, 'terminal.default_term_type', 'xterm-256color'),
    rightClickAction: settingValue(settings, 'terminal.right_click_action', 'menu'),
    copyOnSelect: settingValue(settings, 'terminal.copy_on_select', false),
    uiFontFamily, uiFontFallbackFamily: settingValue(settings, 'appearance.ui_font_fallback_family', DEFAULT_UI_FONT_FALLBACK_FAMILY),
    uiFontSize: settingValue(settings, 'appearance.ui_font_size', DEFAULT_UI_FONT_SIZE),
    windowOpacity: settingValue(settings, 'appearance.window_opacity', DEFAULT_WINDOW_OPACITY),
  })
}

function applyGeneral(settings: GeneralSettings) {
  applyUIFont({ family: settings.uiFontFamily, fallbackFamily: settings.uiFontFallbackFamily, size: settings.uiFontSize })
  applyWindowOpacity(settings.windowOpacity)
  useTerminalBehaviorStore.getState().setSettings({ rightClickAction: settings.rightClickAction, copyOnSelect: settings.copyOnSelect })
  useAppStore.getState().setMaxPoolSize(settings.maxPoolSize)
}

function applyPreview(preview: GeneralPreview) {
  if (preview.uiFontFamily && preview.uiFontFallbackFamily && preview.uiFontSize !== undefined) {
    applyUIFont({ family: preview.uiFontFamily, fallbackFamily: preview.uiFontFallbackFamily, size: preview.uiFontSize })
  }
  if (preview.windowOpacity !== undefined) applyWindowOpacity(preview.windowOpacity)
}

function emitSettingsEvent(name: string, data?: unknown) {
  void Events.Emit(name, data).catch((error: unknown) => logger.error(`emit ${name} failed`, error))
}

async function loadPersistedGeneral() {
  return parseGeneral(await SettingService.GetMany(generalSettingKeys))
}

async function persistGeneral(settings: GeneralSettings) {
  await Promise.all([SettingService.SetMany([
    settingEntry('terminal.max_pool_size', settings.maxPoolSize), settingEntry('terminal.default_keep_alive', settings.defaultKeepAlive),
    settingEntry('terminal.default_term_type', settings.defaultTermType), settingEntry('terminal.right_click_action', settings.rightClickAction),
    settingEntry('terminal.copy_on_select', settings.copyOnSelect), settingEntry('appearance.ui_font_family', settings.uiFontFamily),
    settingEntry('appearance.ui_font_fallback_family', settings.uiFontFallbackFamily), settingEntry('appearance.ui_font_size', settings.uiFontSize),
    settingEntry('appearance.window_opacity', settings.windowOpacity),
  ]), TerminalService.SetMaxSize(settings.maxPoolSize)])
}

function useGeneralEvents(load: () => Promise<void>, setGeneral: Dispatch<SetStateAction<GeneralSettings>>) {
  useEffect(() => {
    const stopPreview = Events.On(SETTINGS_GENERAL_PREVIEW_EVENT, (event: EventEnvelope<GeneralPreview>) => applyPreview(event.data ?? {}))
    const stopChanged = Events.On(SETTINGS_GENERAL_CHANGED_EVENT, (event: EventEnvelope<GeneralSettings>) => {
      if (!event.data) return
      const normalized = normalizeGeneral(event.data)
      applyGeneral(normalized)
      setGeneral(normalized)
    })
    const stopCancelled = Events.On(SETTINGS_PREVIEW_CANCELLED_EVENT, () => { void load() })
    return () => { stopPreview(); stopChanged(); stopCancelled() }
  }, [load, setGeneral])
}

export function useGeneralSettings() {
  const [general, setGeneral] = useState<GeneralSettings>(defaultGeneralSettings)
  const revision = useRef(0)
  const loadGeneral = useCallback(async () => {
    const currentRevision = revision.current
    try {
      const loaded = await loadPersistedGeneral()
      if (currentRevision !== revision.current) return
      applyGeneral(loaded)
      setGeneral(loaded)
    } catch (error) {
      logger.debug('loadGeneral error', error)
    }
  }, [])
  const saveGeneral = useCallback(async (settings: GeneralSettings) => {
    const normalized = normalizeGeneral(settings)
    try {
      await persistGeneral(normalized)
      revision.current++
      applyGeneral(normalized)
      setGeneral(normalized)
      emitSettingsEvent(SETTINGS_GENERAL_CHANGED_EVENT, normalized)
      toast('通用设置已保存', 'success')
    } catch (error) {
      applyGeneral(general)
      logger.debug('saveGeneral error', error)
      toast(`保存设置失败: ${error instanceof Error ? error.message : String(error)}`, 'error')
      throw error
    }
  }, [general])
  const previewUIFont = useCallback((family: string, fallbackFamily: string, size: number) => {
    const preview = { uiFontFamily: family, uiFontFallbackFamily: fallbackFamily, uiFontSize: size }
    applyPreview(preview)
    emitSettingsEvent(SETTINGS_GENERAL_PREVIEW_EVENT, preview)
  }, [])
  const previewWindowOpacity = useCallback((windowOpacity: number) => {
    applyPreview({ windowOpacity })
    emitSettingsEvent(SETTINGS_GENERAL_PREVIEW_EVENT, { windowOpacity })
  }, [])
  useEffect(() => { void loadGeneral() }, [loadGeneral])
  useGeneralEvents(loadGeneral, setGeneral)
  return { general, saveGeneral, previewUIFont, previewWindowOpacity, reloadGeneral: loadGeneral }
}
