import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { Switch } from '@/components/ui/switch'
import { SettingsCard, SettingsRow, SettingsSectionHeader } from '@/components/settings/settings-ui'
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
  return <div>
    <SettingsSectionHeader title={t('应用行为')} description={t('控制主窗口关闭按钮的默认行为与应用调试选项。')} />
    <SettingsCard divided>
      <SettingsRow label={t('关闭按钮行为')} description={t('隐藏到系统托盘以保持连接，或直接退出应用。')}>
        <LabeledSelect
          ariaLabel={t('关闭按钮行为')}
          value={closeButtonAction}
          options={[...closeButtonOptions()]}
          onValueChange={(value) => onCloseButtonActionChange(normalizeCloseButtonAction(value))}
          className="w-44"
        />
      </SettingsRow>
      <SettingsRow label={t('应用调试')} description={t('启用开发者工具（Web 检查器）。更改后需重启应用才能生效，默认关闭。')}>
        <Switch id="application-debug" aria-label={t('应用调试')} checked={debug} onCheckedChange={(value) => onDebugChange(value)} />
      </SettingsRow>
    </SettingsCard>
  </div>
}
