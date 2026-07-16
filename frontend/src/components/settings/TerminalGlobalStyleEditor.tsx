import { useEffect, useState } from 'react'
import { TextCursorInput } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { TerminalSelectionBackgroundField } from '@/components/settings/TerminalSelectionBackgroundField'
import { validTerminalFontFamily, validTerminalFontSize } from '@/components/settings/themeEditorState'
import type { TerminalGlobalStyle } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

const CURSOR_STYLE_OPTIONS = [
  { value: 'block', label: '块状' },
  { value: 'underline', label: '下划线' },
  { value: 'bar', label: '竖线' },
] as const

interface Props {
  style: TerminalGlobalStyle
  disabled?: boolean
  onChange: <Key extends keyof TerminalGlobalStyle>(key: Key, value: TerminalGlobalStyle[Key]) => void
}

export function TerminalGlobalStyleEditor({ style, disabled = false, onChange }: Props) {
  const [fontSize, setFontSize] = useState(String(style.font_size))
  useEffect(() => {
    if (Number.isFinite(style.font_size)) setFontSize(String(style.font_size))
  }, [style.font_size])

  const changeFontSize = (value: string) => {
    setFontSize(value)
    onChange('font_size', value.trim() === '' ? Number.NaN : Number(value))
  }
  const fontFamilyValid = validTerminalFontFamily(style.font_family)
  const fontSizeValid = validTerminalFontSize(style.font_size)

  return <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-sm"><TextCursorInput className="size-4" />全局字体与光标</CardTitle>
      <p className="mt-1 text-sm text-muted-foreground">作为所有终端主题的默认字体、光标样式和选区高亮配置。</p>
    </CardHeader>
    <CardContent>
      <FieldGroup>
        <Field data-disabled={disabled || undefined} data-invalid={!fontFamilyValid}>
          <FieldLabel htmlFor="terminal-global-font-family">终端字体</FieldLabel>
          <Input id="terminal-global-font-family" aria-label="全局终端字体" aria-invalid={!fontFamilyValid} value={style.font_family} disabled={disabled} onChange={(event) => onChange('font_family', event.target.value)} />
          <FieldDescription>支持 CSS 字体族列表，缺失字形会依次使用后续字体。</FieldDescription>
          {!fontFamilyValid && <FieldError>字体不能为空，且最多包含 256 个字符。</FieldError>}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-disabled={disabled || undefined} data-invalid={!fontSizeValid}>
            <FieldLabel htmlFor="terminal-global-font-size">终端字号</FieldLabel>
            <Input id="terminal-global-font-size" aria-label="全局终端字号" aria-invalid={!fontSizeValid} type="number" min={8} max={48} value={fontSize} disabled={disabled} onChange={(event) => changeFontSize(event.target.value)} />
            {!fontSizeValid && <FieldError>字号必须是 8 到 48 的整数。</FieldError>}
          </Field>
          <Field data-disabled={disabled || undefined}>
            <FieldLabel>光标样式</FieldLabel>
            <LabeledSelect ariaLabel="全局光标样式" value={style.cursor_style} options={CURSOR_STYLE_OPTIONS} disabled={disabled} onValueChange={(value) => onChange('cursor_style', value as TerminalGlobalStyle['cursor_style'])} />
          </Field>
        </div>
        <TerminalSelectionBackgroundField id="terminal-global-selection-background" ariaPrefix="全局" value={style.selection_background} disabled={disabled} onChange={(value) => onChange('selection_background', value)} />
      </FieldGroup>
    </CardContent>
  </Card>
}
