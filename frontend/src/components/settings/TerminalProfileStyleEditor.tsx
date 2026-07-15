import { useEffect, useState } from 'react'
import { Blend } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { Switch } from '@/components/ui/switch'
import { effectiveDraftTheme, validTerminalFontFamily, validTerminalFontSize, type ThemeDraft } from '@/components/settings/themeEditorState'
import { isHexColor, safeHexColor } from '@/components/settings/terminalThemeValidation'
import type { TerminalGlobalStyle } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

const CURSOR_STYLE_OPTIONS = [
  { value: 'block', label: '块状' },
  { value: 'underline', label: '下划线' },
  { value: 'bar', label: '竖线' },
] as const

interface Props {
  draft: ThemeDraft
  globalStyle: TerminalGlobalStyle
  disabled?: boolean
  onDraftChange: (draft: ThemeDraft) => void
}

function SelectionBackgroundField({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (value: string) => void }) {
  const valid = isHexColor(value)
  return <Field data-disabled={disabled || undefined} data-invalid={!valid}>
    <FieldLabel htmlFor="terminal-profile-selection-background-hex">选区背景色</FieldLabel>
    <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2">
      <input aria-label="选区背景色选择器" type="color" value={safeHexColor(value)} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="size-8 self-center rounded-lg border border-input bg-transparent p-0.5" />
      <Input id="terminal-profile-selection-background-hex" aria-label="选区背景色 HEX" aria-invalid={!valid} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </div>
    <FieldDescription>控制鼠标选中文本时的背景高亮颜色。</FieldDescription>
    {!valid && <FieldError>请输入 #RRGGBB 格式的颜色值。</FieldError>}
  </Field>
}

export function TerminalProfileStyleEditor({ draft, globalStyle, disabled = false, onDraftChange }: Props) {
  const effective = effectiveDraftTheme(draft, globalStyle)
  const fieldsDisabled = disabled || draft.followGlobalStyle
  const [fontSize, setFontSize] = useState(String(effective.fontSize))
  useEffect(() => {
    if (Number.isFinite(effective.fontSize)) setFontSize(String(effective.fontSize))
  }, [effective.fontSize])

  const update = <Key extends keyof ThemeDraft>(key: Key, value: ThemeDraft[Key]) => onDraftChange({ ...draft, [key]: value })
  const changeFontSize = (value: string) => {
    setFontSize(value)
    update('fontSize', value.trim() === '' ? Number.NaN : Number(value))
  }
  const fontFamilyValid = validTerminalFontFamily(draft.fontFamily)
  const fontSizeValid = validTerminalFontSize(draft.fontSize)

  return <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-sm"><Blend className="size-4" />当前主题字体与光标</CardTitle>
      <p className="mt-1 text-sm text-muted-foreground">字体与光标样式默认继承全局配置；选区背景色由当前 Profile 独立管理。</p>
    </CardHeader>
    <CardContent>
      <FieldGroup>
        <Field orientation="horizontal" data-disabled={disabled || undefined}>
          <FieldContent>
            <FieldLabel htmlFor="terminal-profile-follow-global">跟随全局字体与光标</FieldLabel>
            <FieldDescription>光标颜色和选区背景色始终属于当前主题。</FieldDescription>
          </FieldContent>
          <Switch id="terminal-profile-follow-global" checked={draft.followGlobalStyle} disabled={disabled} onCheckedChange={(checked) => update('followGlobalStyle', checked)} />
        </Field>
        <Field data-disabled={fieldsDisabled || undefined} data-invalid={!fontFamilyValid}>
          <FieldLabel htmlFor="terminal-profile-font-family">主题字体</FieldLabel>
          <Input id="terminal-profile-font-family" aria-label="主题字体" aria-invalid={!fontFamilyValid} value={effective.fontFamily} disabled={fieldsDisabled} onChange={(event) => update('fontFamily', event.target.value)} />
          {!fontFamilyValid && <FieldError>字体不能为空，且最多包含 256 个字符。</FieldError>}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-disabled={fieldsDisabled || undefined} data-invalid={!fontSizeValid}>
            <FieldLabel htmlFor="terminal-profile-font-size">主题字号</FieldLabel>
            <Input id="terminal-profile-font-size" aria-label="主题字号" aria-invalid={!fontSizeValid} type="number" min={8} max={48} value={fontSize} disabled={fieldsDisabled} onChange={(event) => changeFontSize(event.target.value)} />
            {!fontSizeValid && <FieldError>字号必须是 8 到 48 的整数。</FieldError>}
          </Field>
          <Field data-disabled={fieldsDisabled || undefined}>
            <FieldLabel>主题光标样式</FieldLabel>
            <LabeledSelect ariaLabel="主题光标样式" value={effective.cursorStyle} options={CURSOR_STYLE_OPTIONS} disabled={fieldsDisabled} onValueChange={(value) => update('cursorStyle', value as ThemeDraft['cursorStyle'])} />
          </Field>
        </div>
        <SelectionBackgroundField value={draft.selectionBackground} disabled={disabled} onChange={(value) => update('selectionBackground', value)} />
      </FieldGroup>
    </CardContent>
  </Card>
}
