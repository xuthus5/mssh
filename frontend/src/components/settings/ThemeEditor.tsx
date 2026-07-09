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

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-2">
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
