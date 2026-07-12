import { useEffect, useState, type FormEvent } from 'react'
import { Palette, Save, SquareTerminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AnsiPaletteEditor } from '@/components/settings/AnsiPaletteEditor'
import { TerminalThemeInspector } from '@/components/settings/TerminalThemeInspector'
import { TerminalThemePreview } from '@/components/settings/TerminalThemePreview'
import { ThemePresetCombobox } from '@/components/settings/ThemePresetCombobox'
import { findMatchingThemePreset, THEME_PRESETS, type ThemePreset } from '@/components/settings/terminalThemePresets'
import { completeAnsiPalette, hasValidTerminalThemeColors, normalizeTerminalThemeColors } from '@/components/settings/terminalThemeValidation'
import type { TerminalTheme } from '@/hooks/useSettings'

interface Props {
  theme: TerminalTheme
  onSave: (theme: TerminalTheme) => void
}

function applyPreset(theme: TerminalTheme, preset: ThemePreset): TerminalTheme {
  return { ...theme, background: preset.background, foreground: preset.foreground, cursorColor: preset.cursorColor, ansi: [...preset.ansi] }
}

function createThemeDraft(theme: TerminalTheme): TerminalTheme {
  return { ...theme, ansi: completeAnsiPalette(theme.ansi) }
}

export function ThemeEditor({ theme, onSave }: Props) {
  const [draft, setDraft] = useState<TerminalTheme>(() => createThemeDraft(theme))
  const [fontSizeInput, setFontSizeInput] = useState(theme.fontSize.toString())

  useEffect(() => {
    setDraft(createThemeDraft(theme))
    setFontSizeInput(theme.fontSize.toString())
  }, [theme])

  const update = <Key extends keyof TerminalTheme>(key: Key, value: TerminalTheme[Key]) => setDraft((current) => ({ ...current, [key]: value }))
  const updateAnsi = (index: number, color: string) => setDraft((current) => ({ ...current, ansi: current.ansi.map((item, itemIndex) => itemIndex === index ? color : item) }))
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    onSave(normalizeTerminalThemeColors({ ...draft, fontSize: parseInt(fontSizeInput, 10) || 14, ansi: [...draft.ansi] }))
  }
  const selectedPreset = findMatchingThemePreset(draft)
  const previewTheme = { ...draft, fontSize: parseInt(fontSizeInput, 10) || 14 }
  const validColors = hasValidTerminalThemeColors(draft)

  return <form onSubmit={handleSubmit} className="flex flex-col gap-5 pb-2 pt-2">
    <div className="flex flex-col gap-1">
      <h2 className="text-lg font-semibold text-foreground">终端主题</h2>
      <p className="text-sm text-muted-foreground">配置终端配色、字体与光标。预览即时更新，保存后应用到所有终端。</p>
    </div>
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Palette className="size-4" />主题预设</CardTitle></CardHeader>
      <CardContent><ThemePresetCombobox presets={THEME_PRESETS} value={selectedPreset?.name ?? ''} onValueChange={(preset) => setDraft((current) => applyPreset(current, preset))} /></CardContent>
    </Card>
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
      <div className="flex flex-col gap-4 lg:sticky lg:top-0">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><SquareTerminal className="size-4" />实时终端预览</CardTitle></CardHeader>
          <CardContent><TerminalThemePreview theme={previewTheme} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">ANSI 调色板</CardTitle></CardHeader>
          <CardContent><AnsiPaletteEditor colors={draft.ansi} onChange={updateAnsi} /></CardContent>
        </Card>
      </div>
      <TerminalThemeInspector theme={draft} fontSize={fontSizeInput} onThemeChange={update} onFontSizeChange={setFontSizeInput} />
    </div>
    <div className="flex justify-end"><Button type="submit" disabled={!validColors}><Save data-icon="inline-start" />保存主题</Button></div>
  </form>
}
