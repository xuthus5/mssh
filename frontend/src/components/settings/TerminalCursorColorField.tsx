import { TerminalHexColorField } from '@/components/settings/TerminalHexColorField'
import { t } from '@/i18n'


interface Props {
  id: string
  ariaPrefix: string
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}

export function TerminalCursorColorField({ id, ariaPrefix, value, disabled = false, onChange }: Props) {
  return <TerminalHexColorField id={id} label={t('光标颜色')} description={t('控制终端中光标显示的颜色。')} ariaSelectorLabel={t('${}光标颜色选择器', ariaPrefix)} ariaHexLabel={t('${}光标颜色 HEX', ariaPrefix)} value={value} disabled={disabled} onChange={onChange} />
}
