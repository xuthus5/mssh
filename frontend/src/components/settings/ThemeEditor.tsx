import { useState, type FormEvent } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { TerminalTheme } from '@/hooks/useSettings'

interface ThemePreset {
  name: string
  background: string
  foreground: string
  cursorColor: string
  ansi: string[]
}

const THEME_PRESETS: ThemePreset[] = [
  {
    name: 'Solarized Dark',
    background: '#002b36',
    foreground: '#839496',
    cursorColor: '#839496',
    ansi: [
      '#073642', '#dc322f', '#859900', '#b58900',
      '#268bd2', '#d33682', '#2aa198', '#eee8d5',
      '#002b36', '#cb4b16', '#586e75', '#657b83',
      '#839496', '#6c71c4', '#93a1a1', '#fdf6e3',
    ],
  },
  {
    name: 'Monokai',
    background: '#272822',
    foreground: '#f8f8f2',
    cursorColor: '#f8f8f2',
    ansi: [
      '#272822', '#f92672', '#a6e22e', '#f4bf75',
      '#66d9ef', '#ae81ff', '#a1efe4', '#f8f8f2',
      '#75715e', '#f92672', '#a6e22e', '#f4bf75',
      '#66d9ef', '#ae81ff', '#a1efe4', '#f9f8f5',
    ],
  },
  {
    name: 'Dracula',
    background: '#282a36',
    foreground: '#f8f8f2',
    cursorColor: '#f8f8f2',
    ansi: [
      '#21222c', '#ff5555', '#50fa7b', '#f1fa8c',
      '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2',
      '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5',
      '#d6acff', '#ff92df', '#a4ffff', '#ffffff',
    ],
  },
  {
    name: 'One Dark',
    background: '#282c34',
    foreground: '#abb2bf',
    cursorColor: '#528bff',
    ansi: [
      '#282c34', '#e06c75', '#98c379', '#e5c07b',
      '#61afef', '#c678dd', '#56b6c2', '#abb2bf',
      '#5c6370', '#e06c75', '#98c379', '#e5c07b',
      '#61afef', '#c678dd', '#56b6c2', '#ffffff',
    ],
  },
  {
    name: 'GitHub Dark',
    background: '#0d1117',
    foreground: '#c9d1d9',
    cursorColor: '#c9d1d9',
    ansi: [
      '#484f58', '#ff7b72', '#3fb950', '#d29922',
      '#58a6ff', '#bc8cff', '#39c5cf', '#b1bac4',
      '#6e7681', '#ffa198', '#56d364', '#e3b341',
      '#79c0ff', '#d2a8ff', '#56d4dd', '#f0f6fc',
    ],
  },
]

interface Props {
  theme: TerminalTheme
  onSave: (t: TerminalTheme) => void
}

export function ThemeEditor({ theme, onSave }: Props) {
  const [background, setBackground] = useState(theme.background)
  const [foreground, setForeground] = useState(theme.foreground)
  const [cursorColor, setCursorColor] = useState(theme.cursorColor)
  const [cursorStyle, setCursorStyle] = useState<string>(theme.cursorStyle)
  const [fontFamily, setFontFamily] = useState(theme.fontFamily)
  const [fontSize, setFontSize] = useState(theme.fontSize.toString())
  const [ansi, setAnsi] = useState<string[]>([...theme.ansi])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    onSave({
      background,
      foreground,
      cursorColor,
      cursorStyle: cursorStyle as TerminalTheme['cursorStyle'],
      fontFamily,
      fontSize: parseInt(fontSize, 10) || 14,
      ansi,
    })
  }

  const updateAnsi = (index: number, value: string) => {
    const next = [...ansi]
    next[index] = value
    setAnsi(next)
  }

  const applyPreset = (preset: ThemePreset) => {
    setBackground(preset.background)
    setForeground(preset.foreground)
    setCursorColor(preset.cursorColor)
    setAnsi([...preset.ansi])
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-2">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          预设主题
        </label>
        <div className="flex flex-wrap gap-1.5">
          {THEME_PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              className="flex items-center gap-1.5 px-2 py-1 rounded text-xs border border-border hover:border-primary transition-colors"
              onClick={() => applyPreset(preset)}
              title={preset.name}
            >
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: preset.background }}
              />
              {preset.name}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            背景色
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={background}
              onChange={(e) => setBackground(e.target.value)}
              className="w-8 h-8 rounded border border-input cursor-pointer bg-transparent"
            />
            <Input
              value={background}
              onChange={(e) => setBackground(e.target.value)}
              className="flex-1"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            前景色
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={foreground}
              onChange={(e) => setForeground(e.target.value)}
              className="w-8 h-8 rounded border border-input cursor-pointer bg-transparent"
            />
            <Input
              value={foreground}
              onChange={(e) => setForeground(e.target.value)}
              className="flex-1"
            />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            光标颜色
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={cursorColor}
              onChange={(e) => setCursorColor(e.target.value)}
              className="w-8 h-8 rounded border border-input cursor-pointer bg-transparent"
            />
            <Input
              value={cursorColor}
              onChange={(e) => setCursorColor(e.target.value)}
              className="flex-1"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            光标样式
          </label>
          <Select value={cursorStyle} onValueChange={(value) => setCursorStyle(value ?? '')}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="block">方块</SelectItem>
              <SelectItem value="underline">下划线</SelectItem>
              <SelectItem value="bar">竖线</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          字体
        </label>
        <Input
          value={fontFamily}
          onChange={(e) => setFontFamily(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          字号
        </label>
        <Input
          type="number"
          min={8}
          max={48}
          value={fontSize}
          onChange={(e) => setFontSize(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          预览
        </label>
        <div
          className="h-16 rounded-lg border border-border p-2 font-mono text-xs overflow-auto"
          style={{ backgroundColor: background, color: foreground }}
        >
          {ansi.map((color, i) => (
            <span key={i} style={{ color }}>
              ANSI{i}{' '}
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium text-muted-foreground">
          ANSI 16 色
        </label>
        <div className="grid grid-cols-8 gap-1">
          {ansi.map((color, i) => (
            <input
              key={i}
              type="color"
              value={color}
              onChange={(e) => updateAnsi(i, e.target.value)}
              className="w-full aspect-square rounded border border-input cursor-pointer bg-transparent"
              title={`ANSI ${i}`}
            />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1">
          {ansi.map((color, i) => (
            <Input
              key={`hex-${i}`}
              value={color}
              onChange={(e) => updateAnsi(i, e.target.value)}
              className="text-xs h-6"
            />
          ))}
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="submit" size="sm">
          保存主题
        </Button>
      </div>
    </form>
  )
}
