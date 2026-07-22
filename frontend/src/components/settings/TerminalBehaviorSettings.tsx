import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { Switch } from '@/components/ui/switch'
import {
  MAX_TERMINAL_SCROLLBACK_LINES,
  MIN_TERMINAL_SCROLLBACK_LINES,
  normalizeTerminalRightClickAction,
  type TerminalBehaviorSettings,
  type TerminalRightClickAction,
} from '@/store/terminalBehaviorStore'
import { t } from '@/i18n'

const RIGHT_CLICK_OPTIONS = [
  { value: 'menu', label: '显示菜单' },
  { value: 'paste', label: '粘贴' },
] as const

interface Props {
  rightClickAction: TerminalBehaviorSettings['rightClickAction']
  copyOnSelect: boolean
  scrollbackLines: number | string
  autoReconnect: boolean
  restoreTabsOnStartup: boolean
  historyPredict: boolean
  onRightClickActionChange: (value: TerminalRightClickAction) => void
  onCopyOnSelectChange: (value: boolean) => void
  onScrollbackLinesChange: (value: number) => void
  onAutoReconnectChange: (value: boolean) => void
  onRestoreTabsOnStartupChange: (value: boolean) => void
  onHistoryPredictChange: (value: boolean) => void
}

export function TerminalBehaviorSettingsSection({
  rightClickAction,
  copyOnSelect,
  scrollbackLines,
  autoReconnect,
  restoreTabsOnStartup,
  historyPredict,
  onRightClickActionChange,
  onCopyOnSelectChange,
  onScrollbackLinesChange,
  onAutoReconnectChange,
  onRestoreTabsOnStartupChange,
  onHistoryPredictChange,
}: Props) {
  return (
    <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="mb-3">
        <h3 className="text-sm font-medium text-foreground">{t('行为')}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('控制终端中的鼠标、剪贴板、历史缓冲与连接恢复策略。')}
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>{t('鼠标右键行为')}</FieldLabel>
            <FieldDescription>{t('选择显示操作菜单或直接粘贴剪贴板内容。')}</FieldDescription>
          </FieldContent>
          <LabeledSelect
            ariaLabel={t('鼠标右键行为')}
            value={rightClickAction}
            options={RIGHT_CLICK_OPTIONS.map((item) => ({ ...item, label: t(item.label) }))}
            onValueChange={(value) => onRightClickActionChange(normalizeTerminalRightClickAction(value))}
            className="w-40"
          />
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="terminal-copy-on-select">{t('选择即复制')}</FieldLabel>
            <FieldDescription>{t('选中文本后自动写入系统剪贴板。')}</FieldDescription>
          </FieldContent>
          <Switch
            id="terminal-copy-on-select"
            checked={copyOnSelect}
            onCheckedChange={(value) => onCopyOnSelectChange(value)}
          />
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="terminal-scrollback-lines">{t('滚动历史行数')}</FieldLabel>
            <FieldDescription>
              {t(
                '限制每个终端保留的输出历史行数，超出后丢弃最旧内容（${}-${}）。',
                MIN_TERMINAL_SCROLLBACK_LINES,
                MAX_TERMINAL_SCROLLBACK_LINES,
              )}
            </FieldDescription>
          </FieldContent>
          <Input
            id="terminal-scrollback-lines"
            type="number"
            min={MIN_TERMINAL_SCROLLBACK_LINES}
            max={MAX_TERMINAL_SCROLLBACK_LINES}
            step={1000}
            className="w-32"
            value={scrollbackLines === 0 || scrollbackLines === '0' ? '' : scrollbackLines}
            onChange={(event) => {
              const raw = event.target.value
              if (raw.trim() === '') {
                onScrollbackLinesChange(0)
                return
              }
              const parsed = Number.parseInt(raw, 10)
              if (Number.isFinite(parsed)) onScrollbackLinesChange(parsed)
            }}
            aria-label={t('滚动历史行数')}
          />
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="terminal-auto-reconnect">{t('SSH 断线自动重连')}</FieldLabel>
            <FieldDescription>
              {t('意外断开后自动尝试重新连接；手动断开或关闭标签不会触发。默认关闭。')}
            </FieldDescription>
          </FieldContent>
          <Switch
            id="terminal-auto-reconnect"
            checked={autoReconnect}
            onCheckedChange={(value) => onAutoReconnectChange(value)}
          />
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="terminal-restore-tabs">{t('启动时恢复终端标签')}</FieldLabel>
            <FieldDescription>
              {t('重启应用后自动恢复上次未关闭的终端标签。默认开启。')}
            </FieldDescription>
          </FieldContent>
          <Switch
            id="terminal-restore-tabs"
            checked={restoreTabsOnStartup}
            onCheckedChange={(value) => onRestoreTabsOnStartupChange(value)}
          />
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="terminal-history-predict">{t('历史命令预测补全')}</FieldLabel>
            <FieldDescription>
              {t('根据本会话历史命令预测当前输入，按 Tab 补全剩余内容。开启后会拦截 Tab 完成补全；默认关闭。')}
            </FieldDescription>
          </FieldContent>
          <Switch
            id="terminal-history-predict"
            checked={historyPredict}
            onCheckedChange={(value) => onHistoryPredictChange(value)}
          />
        </Field>
      </div>
    </section>
  )
}
