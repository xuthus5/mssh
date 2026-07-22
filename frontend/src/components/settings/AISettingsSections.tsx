import type { ReactNode } from 'react'
import { Globe2, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { AISettingsInput } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { t } from '@/i18n'

export function AIInteractionSettingsSection({
  draft,
  update,
}: {
  draft: AISettingsInput
  update: (changes: Partial<AISettingsInput>) => void
}) {
  const interaction = draft.interaction
  const setInteraction = (changes: Partial<typeof interaction>) =>
    update({ interaction: { ...interaction, ...changes } })
  return (
    <SettingsCard
      icon={<SlidersHorizontal />}
      title={t('交互配置')}
      description={t('控制右侧 AI 面板携带的上下文和对话保留方式。')}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField label={t('面板宽度')} value={interaction.panel_width} min={300} max={900} onChange={(value) => setInteraction({ panel_width: value })} />
        <NumberField label={t('终端上下文行数')} value={interaction.context_lines} min={0} max={500} onChange={(value) => setInteraction({ context_lines: value })} />
        <NumberField label={t('历史保留天数')} value={interaction.history_retention_days} min={1} max={3650} onChange={(value) => setInteraction({ history_retention_days: value })} />
        <NumberField label={t('最多对话数')} value={interaction.max_conversations} min={1} max={1000} onChange={(value) => setInteraction({ max_conversations: value })} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <SettingSwitch label={t('附带会话信息')} checked={interaction.include_session_metadata} onChange={(value) => setInteraction({ include_session_metadata: value })} />
        <SettingSwitch label={t('附带系统摘要')} checked={interaction.include_system_summary} onChange={(value) => setInteraction({ include_system_summary: value })} />
        <SettingSwitch label={t('流式响应')} checked={interaction.stream_responses} onChange={(value) => setInteraction({ stream_responses: value })} />
        <SettingSwitch label={t('自动滚动')} checked={interaction.auto_scroll} onChange={(value) => setInteraction({ auto_scroll: value })} />
        <SettingSwitch label={t('渲染 Markdown')} checked={interaction.render_markdown} onChange={(value) => setInteraction({ render_markdown: value })} />
      </div>
    </SettingsCard>
  )
}

export function AISearchSettingsSection({
  draft,
  update,
  saved,
}: {
  draft: AISettingsInput
  update: (changes: Partial<AISettingsInput>) => void
  saved: boolean
}) {
  const search = draft.search
  const setSearch = (changes: Partial<typeof search>) => update({ search: { ...search, ...changes } })
  return (
    <SettingsCard icon={<Globe2 />} title={t('网络搜索')} description={t('配置 AI 可调用的网络搜索能力与凭据。')}>
      <SettingSwitch label={t('启用网络搜索')} checked={search.enabled} onChange={(value) => setSearch({ enabled: value })} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('搜索模式')}>
          <Select value={search.mode} onValueChange={(value) => setSearch({ mode: value as typeof search.mode })}>
            <SelectTrigger aria-label={t('搜索模式')} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{t('自动')}</SelectItem>
              <SelectItem value="independent">{t('独立搜索')}</SelectItem>
              <SelectItem value="disabled">{t('禁用')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('搜索提供商')}>
          <Select value={search.provider} onValueChange={(value) => setSearch({ provider: value as typeof search.provider })}>
            <SelectTrigger aria-label={t('搜索提供商')} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="brave">Brave</SelectItem>
              <SelectItem value="tavily">Tavily</SelectItem>
              <SelectItem value="serper">Serper</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <NumberField label={t('超时（秒）')} value={search.timeout_seconds} min={1} max={60} onChange={(value) => setSearch({ timeout_seconds: value })} />
        <NumberField label={t('最大结果数')} value={search.max_results} min={1} max={20} onChange={(value) => setSearch({ max_results: value })} />
      </div>
      <Field label={saved ? t('搜索 API Key（已保存，留空保持不变）') : t('搜索 API Key')}>
        <Input
          aria-label={t('搜索 API Key')}
          type="password"
          value={search.api_key}
          onChange={(event) => setSearch({ api_key: event.target.value })}
          autoComplete="new-password"
        />
      </Field>
      <SettingSwitch
        label={t('要求回答提供引用')}
        checked={search.require_citations}
        onChange={(value) => setSearch({ require_citations: value })}
      />
    </SettingsCard>
  )
}

export function AISecuritySettingsSection({
  draft,
  update,
}: {
  draft: AISettingsInput
  update: (changes: Partial<AISettingsInput>) => void
}) {
  const security = draft.security
  const setSecurity = (changes: Partial<typeof security>) => update({ security: { ...security, ...changes } })
  return (
    <SettingsCard icon={<ShieldCheck />} title={t('安全配置')} description={t('命令默认需要审批；内置高风险阻断规则始终生效。')}>
      <SettingSwitch
        label={t('允许只读命令自动执行')}
        checked={security.auto_execute_read_only}
        onChange={(value) => setSecurity({ auto_execute_read_only: value })}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <NumberField label={t('命令超时（秒）')} value={security.command_timeout_seconds} min={1} max={300} onChange={(value) => setSecurity({ command_timeout_seconds: value })} />
        <NumberField label={t('最大输出字节')} value={security.max_output_bytes} min={1024} max={4194304} onChange={(value) => setSecurity({ max_output_bytes: value })} />
        <NumberField label={t('计划最多步骤')} value={security.max_plan_steps} min={1} max={20} onChange={(value) => setSecurity({ max_plan_steps: value })} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <PatternField label={t('允许模式')} value={security.allow_patterns} onChange={(value) => setSecurity({ allow_patterns: value })} />
        <PatternField label={t('禁止模式')} value={security.deny_patterns} onChange={(value) => setSecurity({ deny_patterns: value })} />
        <PatternField label={t('脱敏模式')} value={security.redaction_patterns} onChange={(value) => setSecurity({ redaction_patterns: value })} />
      </div>
    </SettingsCard>
  )
}

function SettingsCard({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          {icon}
          {title}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="grid gap-4">{children}</CardContent>
    </Card>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <Field label={label}>
      <Input
        aria-label={label}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </Field>
  )
}

function PatternField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string[]
  onChange: (value: string[]) => void
}) {
  return (
    <Field label={t('${}（每行一个正则）', label)}>
      <Textarea
        aria-label={label}
        value={value.join('\n')}
        onChange={(event) =>
          onChange(
            event.target.value
              .split('\n')
              .map((item) => item.trim())
              .filter(Boolean),
          )
        }
        rows={4}
      />
    </Field>
  )
}

function SettingSwitch({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  )
}
