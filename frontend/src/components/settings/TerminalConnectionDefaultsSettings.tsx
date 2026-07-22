import { Input } from '@/components/ui/input'
import { LabeledSelect } from '@/components/ui/labeled-select'
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

export function TerminalConnectionDefaultsSettingsSection({
  maxPoolSize,
  defaultKeepAlive,
  defaultTermType,
  onMaxPoolSizeChange,
  onDefaultKeepAliveChange,
  onDefaultTermTypeChange,
}: Props) {
  return (
    <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="mb-3">
        <h3 className="text-sm font-medium text-foreground">{t('连接默认')}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('控制终端连接池容量、SSH 保活与默认 TERM 类型。')}
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="terminal-max-pool-size" className="text-xs font-medium text-muted-foreground">
              {t('最大终端池大小')}
            </label>
            <Input
              id="terminal-max-pool-size"
              type="number"
              min={1}
              value={maxPoolSize}
              onChange={(event) => onMaxPoolSizeChange(event.target.value)}
              aria-label={t('最大终端池大小')}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="terminal-default-keepalive" className="text-xs font-medium text-muted-foreground">
              {t('默认保活间隔 (秒)')}
            </label>
            <Input
              id="terminal-default-keepalive"
              type="number"
              min={1}
              value={defaultKeepAlive}
              onChange={(event) => onDefaultKeepAliveChange(event.target.value)}
              aria-label={t('默认保活间隔 (秒)')}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t('默认终端类型')}</label>
          <LabeledSelect
            ariaLabel={t('默认终端类型')}
            value={defaultTermType}
            options={TERMINAL_TYPE_OPTIONS}
            onValueChange={onDefaultTermTypeChange}
          />
        </div>
      </div>
    </section>
  )
}
