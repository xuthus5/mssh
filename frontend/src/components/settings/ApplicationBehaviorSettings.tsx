import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { Switch } from '@/components/ui/switch'
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
  debug: boolean
  onDebugChange: (value: boolean) => void
  onCloseButtonActionChange: (value: CloseButtonAction) => void
}

export function ApplicationBehaviorSettingsSection({ closeButtonAction, debug, onDebugChange, onCloseButtonActionChange }: Props) {
  return (
    <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="mb-3">
        <h3 className="text-sm font-medium text-foreground">{t('应用行为')}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t('控制主窗口关闭按钮的默认行为与应用调试选项。')}</p>
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
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="application-debug">{t('应用调试')}</FieldLabel>
          <FieldDescription>{t('启用开发者工具（Web 检查器）。更改后需重启应用才能生效，默认关闭。')}</FieldDescription>
        </FieldContent>
        <Switch id="application-debug" checked={debug} onCheckedChange={(value) => onDebugChange(value)} />
      </Field>
    </section>
  )
}
