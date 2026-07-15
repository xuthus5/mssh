import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { normalizeCloseButtonAction, type CloseButtonAction } from '@/hooks/useGeneralSettings'

const CLOSE_BUTTON_OPTIONS = [
  { value: 'tray', label: '最小化到托盘' },
  { value: 'exit', label: '关闭应用' },
] as const

interface Props {
  closeButtonAction: CloseButtonAction
  onCloseButtonActionChange: (value: CloseButtonAction) => void
}

export function ApplicationBehaviorSettingsSection({ closeButtonAction, onCloseButtonActionChange }: Props) {
  return (
    <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="mb-3">
        <h3 className="text-sm font-medium text-foreground">应用行为</h3>
        <p className="mt-1 text-xs text-muted-foreground">控制主窗口关闭按钮的默认行为。</p>
      </div>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel>关闭按钮行为</FieldLabel>
          <FieldDescription>隐藏到系统托盘以保持连接，或直接退出应用。</FieldDescription>
        </FieldContent>
        <LabeledSelect
          ariaLabel="关闭按钮行为"
          value={closeButtonAction}
          options={CLOSE_BUTTON_OPTIONS}
          onValueChange={(value) => onCloseButtonActionChange(normalizeCloseButtonAction(value))}
          className="w-44"
        />
      </Field>
    </section>
  )
}
