import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { normalizeCloseButtonAction, type CloseButtonAction } from '@/hooks/useGeneralSettings'
import { t } from '@/i18n'


function closeButtonOptions() {
  return [
    { value: 'tray', label: t('最小化到托盘') },
    { value: 'exit', label: t('关闭应用') },
  ] as const
}

interface Props {
  closeButtonAction: CloseButtonAction
  onCloseButtonActionChange: (value: CloseButtonAction) => void
}

export function ApplicationBehaviorSettingsSection({ closeButtonAction, onCloseButtonActionChange }: Props) {
  return (
    <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="mb-3">
        <h3 className="text-sm font-medium text-foreground">{t('应用行为')}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t('控制主窗口关闭按钮的默认行为。')}</p>
      </div>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel>{t('关闭按钮行为')}</FieldLabel>
          <FieldDescription>{t('隐藏到系统托盘以保持连接，或直接退出应用。')}</FieldDescription>
        </FieldContent>
        <LabeledSelect
          ariaLabel={t('关闭按钮行为')}
          value={closeButtonAction}
          options={[...closeButtonOptions()]}
          onValueChange={(value) => onCloseButtonActionChange(normalizeCloseButtonAction(value))}
          className="w-44"
        />
      </Field>
    </section>
  )
}
