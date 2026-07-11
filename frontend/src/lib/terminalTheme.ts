import type { TerminalTheme } from '@/store/appStore'

export function xtermTheme(theme: TerminalTheme) {
  return {
    background: theme.background,
    foreground: theme.foreground,
    cursor: theme.cursor,
    cursorAccent: theme.cursorAccent,
    selectionBackground: theme.selectionBackground,
    black: theme.ansiBlack,
    red: theme.ansiRed,
    green: theme.ansiGreen,
    yellow: theme.ansiYellow,
    blue: theme.ansiBlue,
    magenta: theme.ansiMagenta,
    cyan: theme.ansiCyan,
    white: theme.ansiWhite,
    brightBlack: theme.ansiBrightBlack,
    brightRed: theme.ansiBrightRed,
    brightGreen: theme.ansiBrightGreen,
    brightYellow: theme.ansiBrightYellow,
    brightBlue: theme.ansiBrightBlue,
    brightMagenta: theme.ansiBrightMagenta,
    brightCyan: theme.ansiBrightCyan,
    brightWhite: theme.ansiBrightWhite,
  }
}

export function applyTerminalTheme(options: { cursorStyle?: string; fontSize?: number; fontFamily?: string; theme?: object }, theme: TerminalTheme) {
  options.cursorStyle = theme.cursorStyle
  options.fontSize = theme.fontSize
  options.fontFamily = theme.fontFamily
  options.theme = xtermTheme(theme)
}
