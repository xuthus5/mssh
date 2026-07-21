import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { isHexColor, safeHexColor } from '@/components/settings/terminalThemeValidation'
import { t } from '@/i18n'


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
    <FieldLabel htmlFor={`${id}-hex`}>{t('选区背景色')}</FieldLabel>
    <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2">
      <input aria-label={t('${}选区背景色选择器', ariaPrefix)} type="color" value={safeHexColor(value)} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="size-8 self-center rounded-lg border border-input bg-transparent p-0.5" />
      <Input id={`${id}-hex`} aria-label={t('${}选区背景色 HEX', ariaPrefix)} aria-invalid={!valid} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </div>
    <FieldDescription>{t('控制鼠标选中文本时的背景高亮颜色。')}</FieldDescription>
    {!valid && <FieldError>{t('请输入 #RRGGBB 格式的颜色值。')}</FieldError>}
  </Field>
}
