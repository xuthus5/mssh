import type { TerminalGlobalStyle, ThemeProfile } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'
import type { TerminalTheme } from '@/store/appStore'

const FALLBACK_ANSI = ['#000000', '#cd0000', '#00cd00', '#cdcd00', '#0000ee', '#cd00cd', '#00cdcd', '#e5e5e5', '#7f7f7f', '#ff0000', '#00ff00', '#ffff00', '#5c5cff', '#ff00ff', '#00ffff', '#ffffff']

interface ColorPayload {
  background: string
  foreground: string
  cursor: string
  selection: string
  ansi: string[]
}

export function profileToTerminalTheme(profile: ThemeProfile, globalStyle: TerminalGlobalStyle): TerminalTheme {
  if (!profile.definition) throw new Error('主题 Profile 缺少颜色定义')
  const colors = parseColors(profile.definition.color_payload)
  const overrides = parseOverrides(profile.color_overrides)
  const merged = { ...colors, ...overrides }
  const ansi = merged.ansi?.length === 16 ? merged.ansi : colors.ansi
  const fontFamily = profile.follow_global_style ? globalStyle.font_family : profile.font_family
  const fontSize = profile.follow_global_style ? globalStyle.font_size : profile.font_size
  const cursorStyle = profile.follow_global_style ? globalStyle.cursor_style : profile.cursor_style
  const selectionBackground = profile.follow_global_style ? globalStyle.selection_background : merged.selection
  return {
    background: merged.background,
    foreground: merged.foreground,
    cursor: merged.cursor,
    cursorAccent: merged.background,
    selectionBackground,
    cursorStyle: cursorStyle as TerminalTheme['cursorStyle'],
    fontFamily,
    fontSize,
    ansiBlack: ansi[0] ?? FALLBACK_ANSI[0], ansiRed: ansi[1] ?? FALLBACK_ANSI[1], ansiGreen: ansi[2] ?? FALLBACK_ANSI[2], ansiYellow: ansi[3] ?? FALLBACK_ANSI[3],
    ansiBlue: ansi[4] ?? FALLBACK_ANSI[4], ansiMagenta: ansi[5] ?? FALLBACK_ANSI[5], ansiCyan: ansi[6] ?? FALLBACK_ANSI[6], ansiWhite: ansi[7] ?? FALLBACK_ANSI[7],
    ansiBrightBlack: ansi[8] ?? FALLBACK_ANSI[8], ansiBrightRed: ansi[9] ?? FALLBACK_ANSI[9], ansiBrightGreen: ansi[10] ?? FALLBACK_ANSI[10], ansiBrightYellow: ansi[11] ?? FALLBACK_ANSI[11],
    ansiBrightBlue: ansi[12] ?? FALLBACK_ANSI[12], ansiBrightMagenta: ansi[13] ?? FALLBACK_ANSI[13], ansiBrightCyan: ansi[14] ?? FALLBACK_ANSI[14], ansiBrightWhite: ansi[15] ?? FALLBACK_ANSI[15],
  }
}

function parseColors(value: string): ColorPayload {
  const parsed = JSON.parse(value) as ColorPayload
  return { ...parsed, ansi: parsed.ansi?.length === 16 ? parsed.ansi : FALLBACK_ANSI }
}

function parseOverrides(value: string): Partial<ColorPayload> {
  if (!value) return {}
  try { return JSON.parse(value) as Partial<ColorPayload> } catch { return {} }
}
