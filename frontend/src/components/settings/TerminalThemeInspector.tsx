import { Palette, Type } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { isHexColor, safeHexColor } from '@/components/settings/terminalThemeValidation'
import type { TerminalTheme } from '@/hooks/useSettings'

const CURSOR_STYLE_OPTIONS = [
  { value: 'block', label: '方块' },
  { value: 'underline', label: '下划线' },
  { value: 'bar', label: '竖线' },
]

interface Props {
  theme: TerminalTheme
  fontSize: string
  onThemeChange: <Key extends keyof TerminalTheme>(key: Key, value: TerminalTheme[Key]) => void
  onFontSizeChange: (value: string) => void
}

interface ColorFieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
}

function ColorField({ id, label, value, onChange }: ColorFieldProps) {
  const valid = isHexColor(value)
  return <Field data-invalid={!valid}>
    <FieldLabel htmlFor={`${id}-hex`}>{label}</FieldLabel>
    <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2">
      <input aria-label={`${label}选择器`} type="color" value={safeHexColor(value)} onChange={(event) => onChange(event.target.value)} className="size-8 self-center rounded-lg border border-input bg-transparent p-0.5" />
      <Input id={`${id}-hex`} aria-label={`${label} HEX`} aria-invalid={!valid} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
    {!valid && <FieldError>请输入 #RRGGBB 格式的颜色值。</FieldError>}
  </Field>
}

export function TerminalThemeInspector({ theme, fontSize, onThemeChange, onFontSizeChange }: Props) {
  return <div className="flex flex-col gap-4">
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Palette className="size-4" />基础颜色</CardTitle></CardHeader>
      <CardContent><FieldGroup>
        <ColorField id="terminal-background" label="背景色" value={theme.background} onChange={(value) => onThemeChange('background', value)} />
        <ColorField id="terminal-foreground" label="前景色" value={theme.foreground} onChange={(value) => onThemeChange('foreground', value)} />
        <ColorField id="terminal-cursor" label="光标颜色" value={theme.cursorColor} onChange={(value) => onThemeChange('cursorColor', value)} />
      </FieldGroup></CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Type className="size-4" />字体与光标</CardTitle></CardHeader>
      <CardContent><FieldGroup>
        <Field><FieldLabel htmlFor="terminal-font-family">终端字体</FieldLabel><Input id="terminal-font-family" aria-label="终端字体" value={theme.fontFamily} onChange={(event) => onThemeChange('fontFamily', event.target.value)} /></Field>
        <Field><FieldLabel htmlFor="terminal-font-size">终端字号</FieldLabel><Input id="terminal-font-size" aria-label="终端字号" type="number" min={8} max={48} value={fontSize} onChange={(event) => onFontSizeChange(event.target.value)} /></Field>
        <Field><FieldLabel>光标样式</FieldLabel><LabeledSelect ariaLabel="光标样式" value={theme.cursorStyle} options={CURSOR_STYLE_OPTIONS} onValueChange={(value) => onThemeChange('cursorStyle', value as TerminalTheme['cursorStyle'])} /></Field>
      </FieldGroup></CardContent>
    </Card>
  </div>
}
