import { Input } from '@/components/ui/input'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { Switch } from '@/components/ui/switch'
import { SettingsCard, SettingsRow, SettingsSectionHeader } from '@/components/settings/settings-ui'
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
  autoCloseTerminalOnExit: boolean
  onRightClickActionChange: (value: TerminalRightClickAction) => void
  onCopyOnSelectChange: (value: boolean) => void
  onScrollbackLinesChange: (value: number) => void
  onAutoReconnectChange: (value: boolean) => void
  onRestoreTabsOnStartupChange: (value: boolean) => void
  onHistoryPredictChange: (value: boolean) => void
  onAutoCloseTerminalOnExitChange: (value: boolean) => void
}

export function TerminalBehaviorSettingsSection({
  rightClickAction,
  copyOnSelect,
  scrollbackLines,
  autoReconnect,
  restoreTabsOnStartup,
  historyPredict,
  autoCloseTerminalOnExit,
  onRightClickActionChange,
  onCopyOnSelectChange,
  onScrollbackLinesChange,
  onAutoReconnectChange,
  onRestoreTabsOnStartupChange,
  onHistoryPredictChange,
  onAutoCloseTerminalOnExitChange,
}: Props) {
  return <div>
    <SettingsSectionHeader title={t('行为')} description={t('控制终端中的鼠标、剪贴板、历史缓冲与连接恢复策略。')} />
    <SettingsCard divided>
      <RightClickField value={rightClickAction} onChange={onRightClickActionChange} />
      <BehaviorSwitch id="terminal-copy-on-select" label="选择即复制" description="选中文本后自动写入系统剪贴板。" checked={copyOnSelect} onChange={onCopyOnSelectChange} />
      <ScrollbackField value={scrollbackLines} onChange={onScrollbackLinesChange} />
      <BehaviorSwitch id="terminal-auto-reconnect" label="SSH 断线自动重连" description="意外断开后自动尝试重新连接；手动断开或关闭标签不会触发。默认关闭。" checked={autoReconnect} onChange={onAutoReconnectChange} />
      <BehaviorSwitch id="terminal-auto-close-on-exit" label="退出后自动关闭终端" description="关闭活动连接时不再弹窗确认，直接关闭标签。默认关闭，即关闭时询问确认。" checked={autoCloseTerminalOnExit} onChange={onAutoCloseTerminalOnExitChange} />
      <BehaviorSwitch id="terminal-restore-tabs" label="启动时恢复终端标签" description="重启应用后自动恢复上次未关闭的终端标签。默认开启。" checked={restoreTabsOnStartup} onChange={onRestoreTabsOnStartupChange} />
      <BehaviorSwitch id="terminal-history-predict" label="历史命令预测补全" description="根据本会话历史命令，输入时在光标处显示灰色预测，按 Tab 采纳当前 token 并展开候选列表，方向键选择、Enter 确认、Esc 关闭。开启后会拦截 Tab 完成补全；默认关闭。" checked={historyPredict} onChange={onHistoryPredictChange} />
    </SettingsCard>
  </div>
}

function RightClickField({ value, onChange }: { value: Props['rightClickAction']; onChange: Props['onRightClickActionChange'] }) {
  return <SettingsRow label={t('鼠标右键行为')} description={t('选择显示操作菜单或直接粘贴剪贴板内容。')}>
    <LabeledSelect ariaLabel={t('鼠标右键行为')} value={value} options={RIGHT_CLICK_OPTIONS.map((item) => ({ ...item, label: t(item.label) }))} onValueChange={(next) => onChange(normalizeTerminalRightClickAction(next))} className="w-40" />
  </SettingsRow>
}

function ScrollbackField({ value, onChange }: { value: Props['scrollbackLines']; onChange: Props['onScrollbackLinesChange'] }) {
  const handleChange = (raw: string) => {
    if (raw.trim() === '') return onChange(0)
    const parsed = Number.parseInt(raw, 10)
    if (Number.isFinite(parsed)) onChange(parsed)
  }
  return <SettingsRow label={t('滚动历史行数')} description={t('限制每个终端保留的输出历史行数，超出后丢弃最旧内容（${}-${}）。', MIN_TERMINAL_SCROLLBACK_LINES, MAX_TERMINAL_SCROLLBACK_LINES)}>
    <Input id="terminal-scrollback-lines" type="number" min={MIN_TERMINAL_SCROLLBACK_LINES} max={MAX_TERMINAL_SCROLLBACK_LINES} step={1000} className="w-32" value={value === 0 || value === '0' ? '' : value} onChange={(event) => handleChange(event.target.value)} aria-label={t('滚动历史行数')} />
  </SettingsRow>
}

function BehaviorSwitch({ id, label, description, checked, onChange }: { id: string; label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <SettingsRow label={t(label)} description={t(description)}>
    <Switch id={id} aria-label={t(label)} checked={checked} onCheckedChange={(value) => onChange(value)} />
  </SettingsRow>
}
