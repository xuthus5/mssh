import type { TerminalTheme } from '@/hooks/useSettings'

export interface ThemePreset {
  name: string
  background: string
  foreground: string
  cursorColor: string
  ansi: string[]
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    name: 'Solarized Dark', background: '#002b36', foreground: '#839496', cursorColor: '#839496',
    ansi: ['#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5', '#002b36', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3'],
  },
  {
    name: 'Monokai', background: '#272822', foreground: '#f8f8f2', cursorColor: '#f8f8f2',
    ansi: ['#272822', '#f92672', '#a6e22e', '#f4bf75', '#66d9ef', '#ae81ff', '#a1efe4', '#f8f8f2', '#75715e', '#f92672', '#a6e22e', '#f4bf75', '#66d9ef', '#ae81ff', '#a1efe4', '#f9f8f5'],
  },
  {
    name: 'Dracula', background: '#282a36', foreground: '#f8f8f2', cursorColor: '#f8f8f2',
    ansi: ['#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2', '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff'],
  },
  {
    name: 'One Dark', background: '#282c34', foreground: '#abb2bf', cursorColor: '#528bff',
    ansi: ['#282c34', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#abb2bf', '#5c6370', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#ffffff'],
  },
  {
    name: 'GitHub Dark', background: '#0d1117', foreground: '#c9d1d9', cursorColor: '#c9d1d9',
    ansi: ['#484f58', '#ff7b72', '#3fb950', '#d29922', '#58a6ff', '#bc8cff', '#39c5cf', '#b1bac4', '#6e7681', '#ffa198', '#56d364', '#e3b341', '#79c0ff', '#d2a8ff', '#56d4dd', '#f0f6fc'],
  },
]

export function findMatchingThemePreset(theme: TerminalTheme): ThemePreset | undefined {
  return THEME_PRESETS.find((preset) => preset.background === theme.background
    && preset.foreground === theme.foreground
    && preset.cursorColor === theme.cursorColor
    && preset.ansi.every((color, index) => theme.ansi[index] === color))
}
