import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { isHexColor, safeHexColor } from '@/components/settings/terminalThemeValidation'

interface Props {
  id: string
  ariaPrefix: string
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}

export function TerminalSelectionBackgroundField({ id, ariaPrefix, value, disabled = false, onChange }: Props) {
  const valid = isHexColor(value)
  return <Field data-disabled={disabled || undefined} data-invalid={!valid}>
    <FieldLabel htmlFor={`${id}-hex`}>选区背景色</FieldLabel>
    <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2">
      <input aria-label={`${ariaPrefix}选区背景色选择器`} type="color" value={safeHexColor(value)} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="size-8 self-center rounded-lg border border-input bg-transparent p-0.5" />
      <Input id={`${id}-hex`} aria-label={`${ariaPrefix}选区背景色 HEX`} aria-invalid={!valid} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </div>
    <FieldDescription>控制鼠标选中文本时的背景高亮颜色。</FieldDescription>
    {!valid && <FieldError>请输入 #RRGGBB 格式的颜色值。</FieldError>}
  </Field>
}
