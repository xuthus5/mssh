import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { SettingsCard, SettingsRow, SettingsSectionHeader } from '@/components/settings/settings-ui'
import { type KeywordHighlightRule } from '@/store/terminalKeywordHighlightStore'
import { t } from '@/i18n'

interface Props {
  enabled: boolean
  caseInsensitive: boolean
  rules: KeywordHighlightRule[]
  onEnabledChange: (value: boolean) => void
  onCaseInsensitiveChange: (value: boolean) => void
  onRulesChange: (rules: KeywordHighlightRule[]) => void
  onReset: () => void
}

export function TerminalKeywordHighlightSettingsSection({ enabled, caseInsensitive, rules, onEnabledChange, onCaseInsensitiveChange, onRulesChange, onReset }: Props) {
  const addRule = () => onRulesChange([...rules, { keyword: '', color: '#50fa7b' }])
  const updateRule = (index: number, next: KeywordHighlightRule) => {
    const updated = [...rules]
    updated[index] = next
    onRulesChange(updated)
  }
  const removeRule = (index: number) => onRulesChange(rules.filter((_, current) => current !== index))
  return (
    <div>
      <SettingsSectionHeader title={t('关键字高亮')} description={t('按关键词对终端输出上色，便于快速定位日志信息。')} />
      <SettingsCard divided>
        <SettingsRow label={t('启用关键字高亮')} description={t('开启后，匹配到的关键词会以指定的颜色高亮显示。')}>
          <Switch id="terminal-keyword-highlight" aria-label={t('启用关键字高亮')} checked={enabled} onCheckedChange={(value) => onEnabledChange(value)} />
        </SettingsRow>
        <SettingsRow label={t('忽略大小写')} description={t('开启后不区分大小写，例如 Error 也会匹配 error。')}>
          <Switch id="terminal-keyword-highlight-case-insensitive" aria-label={t('忽略大小写')} checked={caseInsensitive} onCheckedChange={(value) => onCaseInsensitiveChange(value)} />
        </SettingsRow>
        <div className="flex flex-col gap-3 px-4 py-3">
          <RuleRows rules={rules} onInputChange={(index, rule) => updateRule(index, rule)} onRemove={removeRule} />
          <div className="flex items-center justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={onReset}>{t('恢复系统默认')}</Button>
            <Button type="button" size="sm" onClick={addRule}>{t('添加规则')}</Button>
          </div>
        </div>
      </SettingsCard>
    </div>
  )
}

function RuleRows({ rules, onInputChange, onRemove }: { rules: KeywordHighlightRule[]; onInputChange: (index: number, rule: KeywordHighlightRule) => void; onRemove: (index: number) => void }) {
  if (rules.length === 0) return <p className="text-xs text-muted-foreground">{t('尚未添加规则，可点击“添加规则”新增。')}</p>
  return <ul className="flex flex-col gap-2">
    {rules.map((rule, index) => <RuleRow
      key={index}
      rule={rule}
      index={index}
      onChange={onInputChange}
      onRemove={onRemove}
    />)}
  </ul>
}

function RuleRow({ rule, index, onChange, onRemove }: { rule: KeywordHighlightRule; index: number; onChange: (index: number, rule: KeywordHighlightRule) => void; onRemove: (index: number) => void }) {
  const setKeyword = (keyword: string) => onChange(index, { ...rule, keyword })
  const setColor = (color: string) => onChange(index, { ...rule, color })
  return (
    <li className="flex items-center gap-2">
      <input aria-label={t('关键词颜色')} type="color" value={rule.color} onChange={(event) => setColor(event.target.value)} className="size-8 shrink-0 rounded-lg border border-input bg-transparent p-0.5" />
      <Input aria-label={t('关键词')} value={rule.keyword} placeholder={t('例如 Error')} onChange={(event) => setKeyword(event.target.value)} className="min-w-0 flex-1" />
      <Button type="button" size="icon-sm" variant="ghost" aria-label={t('删除规则')} onClick={() => onRemove(index)}>{t('删除')}</Button>
    </li>
  )
}