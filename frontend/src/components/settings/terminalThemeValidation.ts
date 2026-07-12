import type { TerminalTheme } from '@/hooks/useSettings'

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i
const DEFAULT_ANSI_COLORS = [
  '#000000', '#cd0000', '#00cd00', '#cdcd00',
  '#0000ee', '#cd00cd', '#00cdcd', '#e5e5e5',
  '#7f7f7f', '#ff0000', '#00ff00', '#ffff00',
  '#5c5cff', '#ff00ff', '#00ffff', '#ffffff',
]

export function isHexColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value.trim())
}

export function safeHexColor(value: string): string {
  return isHexColor(value) ? value.trim().toLowerCase() : '#000000'
}

export function completeAnsiPalette(colors: string[]): string[] {
  return DEFAULT_ANSI_COLORS.map((fallback, index) => colors[index] ?? fallback)
}

export function hasValidTerminalThemeColors(theme: TerminalTheme): boolean {
  return isHexColor(theme.background)
    && isHexColor(theme.foreground)
    && isHexColor(theme.cursorColor)
    && theme.ansi.length === 16
    && theme.ansi.every(isHexColor)
}

export function normalizeTerminalThemeColors(theme: TerminalTheme): TerminalTheme {
  return {
    ...theme,
    background: safeHexColor(theme.background),
    foreground: safeHexColor(theme.foreground),
    cursorColor: safeHexColor(theme.cursorColor),
    ansi: theme.ansi.map(safeHexColor),
  }
}
