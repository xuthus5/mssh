import { TerminalHexColorField } from '@/components/settings/TerminalHexColorField'
import { t } from '@/i18n'


interface Props {
  id: string
  ariaPrefix: string
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}

export function TerminalSelectionBackgroundField({ id, ariaPrefix, value, disabled = false, onChange }: Props) {
  return <TerminalHexColorField id={id} label={t('选区背景色')} description={t('控制鼠标选中文本时的背景高亮颜色。')} ariaSelectorLabel={t('${}选区背景色选择器', ariaPrefix)} ariaHexLabel={t('${}选区背景色 HEX', ariaPrefix)} value={value} disabled={disabled} onChange={onChange} />
}
