import { Input } from '@/components/ui/input'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { SettingsCard, SettingsSectionHeader } from '@/components/settings/settings-ui'
import { t } from '@/i18n'

const TERMINAL_TYPE_OPTIONS = ['xterm-256color', 'xterm', 'vt100', 'linux'].map((value) => ({
  value,
  label: value,
}))

interface Props {
  maxPoolSize: string
  defaultKeepAlive: string
  defaultTermType: string
  onMaxPoolSizeChange: (value: string) => void
  onDefaultKeepAliveChange: (value: string) => void
  onDefaultTermTypeChange: (value: string) => void
}

function ConnectionNumberField({ id, label, value, onChange }: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return <div className="flex flex-col gap-1.5">
    <label htmlFor={id} className="text-xs font-medium text-muted-foreground">{label}</label>
    <Input id={id} type="number" min={1} value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} />
  </div>
}

export function TerminalConnectionDefaultsSettingsSection(props: Props) {
  return <div>
    <SettingsSectionHeader title={t('连接默认')} description={t('控制终端连接池容量、SSH 保活与默认 TERM 类型。')} />
    <SettingsCard>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <ConnectionNumberField id="terminal-max-pool-size" label={t('最大终端池大小')} value={props.maxPoolSize} onChange={props.onMaxPoolSizeChange} />
          <ConnectionNumberField id="terminal-default-keepalive" label={t('默认保活间隔 (秒)')} value={props.defaultKeepAlive} onChange={props.onDefaultKeepAliveChange} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t('默认终端类型')}</label>
          <LabeledSelect
            ariaLabel={t('默认终端类型')}
            value={props.defaultTermType}
            options={TERMINAL_TYPE_OPTIONS}
            onValueChange={props.onDefaultTermTypeChange}
          />
        </div>
      </div>
    </SettingsCard>
  </div>
}
