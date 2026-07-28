import type { Setting, SettingInput } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { applyUIFont, clampUIFontSize, DEFAULT_UI_FONT_FALLBACK_FAMILY, DEFAULT_UI_FONT_FAMILY, DEFAULT_UI_FONT_SIZE, normalizeUIFontFallbackFamily, normalizeUIFontFamily } from '@/lib/uiFont'
import {
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
  DEFAULT_TERMINAL_RENDERER,
  normalizeAutoReconnect,
  normalizeCopyOnSelect,
  normalizeHistoryPredict,
  normalizeRestoreTabsOnStartup,
  normalizeScrollbackLines,
  normalizeTerminalRenderer,
  normalizeTerminalRightClickAction,
  useTerminalBehaviorStore,
  type TerminalRenderer,
  type TerminalRightClickAction,
} from '@/store/terminalBehaviorStore'
import { useAppStore } from '@/store/appStore'
import { SettingService, TerminalService } from '@/lib/wails'
import { LANGUAGE_SETTING_KEY, type AppLanguage, useLanguageStore } from '@/i18n'
import { logger } from '@/lib/logger'
import { Events } from '@wailsio/runtime'

export const generalSettingKeys = [
  'terminal.max_pool_size', 'terminal.default_keep_alive', 'terminal.default_term_type',
  'terminal.right_click_action', 'terminal.copy_on_select', 'terminal.scrollback_lines', 'terminal.auto_reconnect', 'terminal.restore_tabs_on_startup', 'terminal.renderer', 'terminal.history_predict', 'terminal.local_shell', 'terminal.local_shell_args', 'terminal.local_shell_cwd', 'terminal.local_shell_login', 'appearance.ui_font_family',
  'appearance.ui_font_fallback_family', 'appearance.ui_font_size',
  'application.close_button_action', 'application.log_dir', 'application.log_retention_days',
  'application.proxy_mode', 'application.proxy_url', 'application.proxy_no_proxy',
  'application.proxy_username', 'application.proxy_password', 'application.proxy_password_saved',
  LANGUAGE_SETTING_KEY,
]

export const DEFAULT_TERMINAL_POOL_SIZE = 10

export type CloseButtonAction = 'tray' | 'exit'
export type NetworkProxyMode = 'system' | 'direct' | 'manual'

export interface GeneralSettings {
  maxPoolSize: number
  defaultKeepAlive: number
  defaultTermType: string
  uiFontFamily: string
  uiFontFallbackFamily: string
  uiFontSize: number
  rightClickAction: TerminalRightClickAction
  copyOnSelect: boolean
  scrollbackLines: number
  autoReconnect: boolean
  restoreTabsOnStartup: boolean
  renderer: TerminalRenderer
  historyPredict: boolean
  localShell: string
  localShellArgs: string
  localShellCwd: string
  localShellLogin: boolean
  closeButtonAction: CloseButtonAction
  logDir: string
  logRetentionDays: number
  proxyMode: NetworkProxyMode
  proxyURL: string
  proxyNoProxy: string
  proxyUsername: string
  proxyPassword: string
  proxyPasswordSaved: boolean
  clearProxyPassword: boolean
  language: AppLanguage
}

export interface GeneralPreview {
  uiFontFamily?: string
  uiFontFallbackFamily?: string
  uiFontSize?: number
}

export interface EventEnvelope<T> { data?: T }

export const defaultGeneralSettings: GeneralSettings = {
  maxPoolSize: DEFAULT_TERMINAL_POOL_SIZE, defaultKeepAlive: 60, defaultTermType: 'xterm-256color',
  uiFontFamily: DEFAULT_UI_FONT_FAMILY, uiFontFallbackFamily: DEFAULT_UI_FONT_FALLBACK_FAMILY,
  uiFontSize: DEFAULT_UI_FONT_SIZE,
  rightClickAction: 'menu', copyOnSelect: false, scrollbackLines: DEFAULT_TERMINAL_SCROLLBACK_LINES, autoReconnect: false, restoreTabsOnStartup: true, renderer: DEFAULT_TERMINAL_RENDERER, historyPredict: false, localShell: '', localShellArgs: '', localShellCwd: '', localShellLogin: true,
  closeButtonAction: 'tray',
  logDir: '',
  logRetentionDays: 30,
  proxyMode: 'system',
  proxyURL: '',
  proxyNoProxy: '',
  proxyUsername: '',
  proxyPassword: '',
  proxyPasswordSaved: false,
  clearProxyPassword: false,
  language: 'zh-CN',
}

export function normalizeCloseButtonAction(value: unknown): CloseButtonAction {
  return value === 'exit' ? 'exit' : 'tray'
}

export function normalizeLogDir(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeMaxPoolSize(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_TERMINAL_POOL_SIZE
  return Math.floor(parsed)
}

export function normalizeLogRetentionDays(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 1) return 30
  if (parsed > 3650) return 3650
  return Math.floor(parsed)
}

export function normalizeProxyMode(value: unknown): NetworkProxyMode {
  if (value === 'direct' || value === 'manual' || value === 'system') return value
  return 'system'
}

export function normalizeProxyText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function settingEntry(key: string, value: unknown): SettingInput {
  const valueType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'object' ? 'object' : typeof value
  return { key, namespace: key.split('.')[0], value: JSON.stringify(value), value_type: valueType, version: 1 }
}

export function settingValue<T>(settings: { [_ in string]?: Setting }, key: string, fallback: T): T {
  const setting = settings[key]
  if (setting === undefined) return fallback
  return JSON.parse(setting.value) as T
}

export function normalizeGeneral(settings: GeneralSettings): GeneralSettings {
  const uiFontFamily = normalizeUIFontFamily(settings.uiFontFamily)
  return {
    ...settings,
    maxPoolSize: normalizeMaxPoolSize(settings.maxPoolSize),
    uiFontFamily,
    uiFontFallbackFamily: normalizeUIFontFallbackFamily(settings.uiFontFallbackFamily, uiFontFamily),
    uiFontSize: clampUIFontSize(settings.uiFontSize),
    rightClickAction: normalizeTerminalRightClickAction(settings.rightClickAction),
    copyOnSelect: normalizeCopyOnSelect(settings.copyOnSelect),
    scrollbackLines: normalizeScrollbackLines(settings.scrollbackLines),
    autoReconnect: normalizeAutoReconnect(settings.autoReconnect),
    restoreTabsOnStartup: normalizeRestoreTabsOnStartup(settings.restoreTabsOnStartup),
    renderer: normalizeTerminalRenderer(settings.renderer),
    historyPredict: normalizeHistoryPredict(settings.historyPredict),
    localShell: String(settings.localShell ?? ''),
    localShellArgs: String(settings.localShellArgs ?? ''),
    localShellCwd: String(settings.localShellCwd ?? ''),
    localShellLogin: settings.localShellLogin !== false,
    closeButtonAction: normalizeCloseButtonAction(settings.closeButtonAction),
    logDir: normalizeLogDir(settings.logDir),
    logRetentionDays: normalizeLogRetentionDays(settings.logRetentionDays),
    proxyMode: normalizeProxyMode(settings.proxyMode),
    proxyURL: normalizeProxyText(settings.proxyURL),
    proxyNoProxy: normalizeProxyText(settings.proxyNoProxy),
    proxyUsername: normalizeProxyText(settings.proxyUsername),
    proxyPassword: typeof settings.proxyPassword === 'string' ? settings.proxyPassword : '',
    proxyPasswordSaved: settings.proxyPasswordSaved === true,
    clearProxyPassword: settings.clearProxyPassword === true,
    language: settings.language === 'en' ? 'en' : 'zh-CN',
  }
}

export function parseGeneral(settings: { [_ in string]?: Setting }): GeneralSettings {
  const uiFontFamily = normalizeUIFontFamily(settingValue(settings, 'appearance.ui_font_family', DEFAULT_UI_FONT_FAMILY))
  return normalizeGeneral({
    maxPoolSize: settingValue(settings, 'terminal.max_pool_size', DEFAULT_TERMINAL_POOL_SIZE),
    defaultKeepAlive: settingValue(settings, 'terminal.default_keep_alive', 60),
    defaultTermType: settingValue(settings, 'terminal.default_term_type', 'xterm-256color'),
    rightClickAction: settingValue(settings, 'terminal.right_click_action', 'menu'),
    copyOnSelect: settingValue(settings, 'terminal.copy_on_select', false),
    scrollbackLines: settingValue(settings, 'terminal.scrollback_lines', DEFAULT_TERMINAL_SCROLLBACK_LINES),
    autoReconnect: settingValue(settings, 'terminal.auto_reconnect', false),
    restoreTabsOnStartup: settingValue(settings, 'terminal.restore_tabs_on_startup', true),
    renderer: settingValue(settings, 'terminal.renderer', DEFAULT_TERMINAL_RENDERER),
    historyPredict: settingValue(settings, 'terminal.history_predict', false),
    localShell: settingValue(settings, 'terminal.local_shell', ''),
    localShellArgs: settingValue(settings, 'terminal.local_shell_args', ''),
    localShellCwd: settingValue(settings, 'terminal.local_shell_cwd', ''),
    localShellLogin: settingValue(settings, 'terminal.local_shell_login', true),
    uiFontFamily, uiFontFallbackFamily: settingValue(settings, 'appearance.ui_font_fallback_family', DEFAULT_UI_FONT_FALLBACK_FAMILY),
    uiFontSize: settingValue(settings, 'appearance.ui_font_size', DEFAULT_UI_FONT_SIZE),
    closeButtonAction: settingValue(settings, 'application.close_button_action', 'tray'),
    logDir: settingValue(settings, 'application.log_dir', ''),
    logRetentionDays: settingValue(settings, 'application.log_retention_days', 30),
    proxyMode: settingValue(settings, 'application.proxy_mode', 'system'),
    proxyURL: settingValue(settings, 'application.proxy_url', ''),
    proxyNoProxy: settingValue(settings, 'application.proxy_no_proxy', ''),
    proxyUsername: settingValue(settings, 'application.proxy_username', ''),
    proxyPassword: '',
    proxyPasswordSaved: Boolean(settingValue(settings, 'application.proxy_password_saved', false)),
    clearProxyPassword: false,
    language: (settingValue<string>(settings, LANGUAGE_SETTING_KEY, 'zh-CN') === 'en' ? 'en' : 'zh-CN'),
  })
}

export function applyGeneral(settings: GeneralSettings) {
  applyUIFont({ family: settings.uiFontFamily, fallbackFamily: settings.uiFontFallbackFamily, size: settings.uiFontSize })
  useTerminalBehaviorStore.getState().setSettings({ rightClickAction: settings.rightClickAction, copyOnSelect: settings.copyOnSelect, scrollbackLines: settings.scrollbackLines, autoReconnect: settings.autoReconnect, restoreTabsOnStartup: settings.restoreTabsOnStartup, renderer: settings.renderer, historyPredict: settings.historyPredict })
  useAppStore.getState().setMaxPoolSize(settings.maxPoolSize)
  useLanguageStore.getState().hydrateLanguage(settings.language)
}

export function applyPreview(preview: GeneralPreview) {
  if (preview.uiFontFamily && preview.uiFontFallbackFamily && preview.uiFontSize !== undefined) {
    applyUIFont({ family: preview.uiFontFamily, fallbackFamily: preview.uiFontFallbackFamily, size: preview.uiFontSize })
  }
}

export function emitSettingsEvent(name: string, data?: unknown) {
  void Events.Emit(name, data).catch((error: unknown) => logger.error(`emit ${name} failed`, error))
}

export async function loadPersistedGeneral() {
  return parseGeneral(await SettingService.GetMany(generalSettingKeys))
}

export async function persistGeneral(settings: GeneralSettings) {
  const normalized = normalizeGeneral(settings)
  await SettingService.SetMany([
    settingEntry('terminal.max_pool_size', normalized.maxPoolSize), settingEntry('terminal.default_keep_alive', normalized.defaultKeepAlive),
    settingEntry('terminal.default_term_type', normalized.defaultTermType), settingEntry('terminal.right_click_action', normalized.rightClickAction),
    settingEntry('terminal.copy_on_select', normalized.copyOnSelect), settingEntry('terminal.scrollback_lines', normalized.scrollbackLines), settingEntry('terminal.auto_reconnect', normalized.autoReconnect), settingEntry('terminal.restore_tabs_on_startup', normalized.restoreTabsOnStartup), settingEntry('terminal.renderer', normalized.renderer), settingEntry('terminal.history_predict', normalized.historyPredict), settingEntry('terminal.local_shell', normalized.localShell), settingEntry('terminal.local_shell_args', normalized.localShellArgs), settingEntry('terminal.local_shell_cwd', normalized.localShellCwd), settingEntry('terminal.local_shell_login', normalized.localShellLogin), settingEntry('appearance.ui_font_family', normalized.uiFontFamily),
    settingEntry('appearance.ui_font_fallback_family', normalized.uiFontFallbackFamily), settingEntry('appearance.ui_font_size', normalized.uiFontSize),
    settingEntry('application.close_button_action', normalized.closeButtonAction),
    settingEntry('application.log_dir', normalized.logDir),
    settingEntry('application.log_retention_days', normalized.logRetentionDays),
    settingEntry('application.proxy_mode', normalized.proxyMode),
    settingEntry('application.proxy_url', normalized.proxyURL),
    settingEntry('application.proxy_no_proxy', normalized.proxyNoProxy),
    settingEntry('application.proxy_username', normalized.proxyUsername),
    settingEntry('application.proxy_password', resolveProxyPasswordWrite(normalized)),
    settingEntry(LANGUAGE_SETTING_KEY, normalized.language),
  ])
  await TerminalService.SetMaxSize(normalized.maxPoolSize)
}

/** Empty keeps the existing secret; null clears it; non-empty stores the exact password. */
export function resolveProxyPasswordWrite(settings: Pick<GeneralSettings, 'proxyPassword' | 'clearProxyPassword'>): string | null {
  if (settings.clearProxyPassword) return null
  return typeof settings.proxyPassword === 'string' ? settings.proxyPassword : ''
}
