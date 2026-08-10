import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { isHexColor, safeHexColor } from '@/components/settings/terminalThemeValidation'
import { t } from '@/i18n'


interface Props {
  id: string
  label: string
  description: string
  ariaSelectorLabel: string
  ariaHexLabel: string
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}

export function TerminalHexColorField({ id, label, description, ariaSelectorLabel, ariaHexLabel, value, disabled = false, onChange }: Props) {
  const valid = isHexColor(value)
  return <Field data-disabled={disabled || undefined} data-invalid={!valid}>
    <FieldLabel htmlFor={`${id}-hex`}>{label}</FieldLabel>
    <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2">
      <input aria-label={ariaSelectorLabel} type="color" value={safeHexColor(value)} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="size-8 self-center rounded-lg border border-input bg-transparent p-0.5" />
      <Input id={`${id}-hex`} aria-label={ariaHexLabel} aria-invalid={!valid} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </div>
    <FieldDescription>{description}</FieldDescription>
    {!valid && <FieldError>{t('请输入 #RRGGBB 格式的颜色值。')}</FieldError>}
  </Field>
}
