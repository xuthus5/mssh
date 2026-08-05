import type { ReactNode } from 'react'
import { Check, FlaskConical, Plus, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import type { AIProviderProfile, AISettingsInput } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { AIProviderType } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import type { AISettingsController } from '@/hooks/useAISettings'
import { useAIProviderPanelRuntime, type AIProviderPanelRuntime } from '@/components/settings/aiProviderPanelRuntime'
import { AIProviderAdvancedFields } from '@/components/settings/AIProviderAdvancedFields'
import { AIProviderCatalogFields } from '@/components/settings/AIProviderCatalogFields'
import { selectedCatalogModel } from '@/components/settings/aiModelsDevCatalog'
import { useModelsDevCatalog } from '@/hooks/useModelsDevCatalog'
import { t } from '@/i18n'

const providerLabels = { openai_compatible: 'OpenAI 兼容', anthropic: 'Anthropic', gemini: 'Gemini', ollama: 'Ollama' } as const
type ProviderKind = keyof typeof providerLabels

function providerTypeLabel(provider: string): string {
  return t(providerLabels[provider as ProviderKind] ?? provider)
}

type ProviderPriorities = Pick<AISettingsInput, 'default_provider_id' | 'fallback_provider_id'>

interface Props {
  controller: AISettingsController
  priorities: ProviderPriorities
  onPriorityChange: (changes: Partial<ProviderPriorities>) => void
  onProviderDeleted: (providerID: number) => void
}

export function AIProviderPanel({ controller, priorities, onPriorityChange, onProviderDeleted }: Props) {
  const model = useAIProviderPanelRuntime(controller, onProviderDeleted)
  const catalog = useModelsDevCatalog()
  return <div className="grid min-w-0 gap-4">
    {controller.error ? <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{controller.error}</div> : null}
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(220px,0.8fr)_minmax(360px,1.5fr)]">
      <ProviderListCard model={model} priorities={priorities} onPriorityChange={onPriorityChange} />
      <ProviderEditorCard controller={controller} model={model} catalog={catalog} />
    </div>
  </div>
}

function ProviderListCard({ model, priorities, onPriorityChange }: Pick<Props, 'priorities' | 'onPriorityChange'> & { model: AIProviderPanelRuntime }) {
  const providers = model.dashboard?.providers ?? []
  return <Card className="min-w-0 shadow-sm"><CardHeader className="flex-row items-center justify-between"><CardTitle className="text-sm">{t('提供商')}</CardTitle><Button size="sm" variant="outline" onClick={model.selectNewProvider}><Plus data-icon="inline-start" />{t('新增提供商')}</Button></CardHeader><CardContent className="space-y-2">{providers.map((profile) => <ProviderRow key={profile.id} profile={profile} selected={model.selectedID === profile.id} isDefault={profile.id === priorities.default_provider_id} deleting={model.deleting} onSelect={model.selectProvider} onDelete={() => { void model.deleteProvider(profile).catch(() => undefined) }} />)}{providers.length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">{t('尚未配置提供商')}</p> : null}{model.dashboard ? <ProviderPrioritySettings priorities={priorities} providers={providers} keychainAvailable={model.dashboard.keychain_available} onChange={onPriorityChange} /> : null}</CardContent></Card>
}

function ProviderRow({ profile, selected, isDefault, deleting, onSelect, onDelete }: { profile: AIProviderProfile; selected: boolean; isDefault: boolean; deleting: boolean; onSelect: (profile: AIProviderProfile) => void; onDelete: () => void }) {
  return <div className={`flex items-center justify-between gap-2 rounded-lg border p-3 transition-colors ${selected ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}>
    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelect(profile)} aria-label={profile.name}>
      <span className="block truncate text-sm font-medium">{profile.name}</span>
      <span className="block truncate text-xs text-muted-foreground">{t(providerLabels[profile.provider as ProviderKind] ?? profile.provider)} · {profile.default_model || t('未设置模型')}</span>
    </button>
    <span className="flex shrink-0 items-center gap-1">
      {profile.credential_saved ? <Check className="size-3.5 text-emerald-600" aria-label={t('凭据已保存')} /> : null}
      {isDefault ? <Badge variant="secondary">{t('默认')}</Badge> : null}
      <Button size="icon-xs" variant="ghost" aria-label={t('删除提供商')} disabled={deleting} onClick={onDelete}><Trash2 /></Button>
    </span>
  </div>
}

function ProviderPrioritySettings({ priorities, providers, keychainAvailable, onChange }: {
  priorities: ProviderPriorities
  providers: AIProviderProfile[]
  keychainAvailable: boolean
  onChange: Props['onPriorityChange']
}) {
  const update = (key: keyof ProviderPriorities, value: string | null) => onChange({ [key]: !value || value === 'none' ? null : Number(value) })
  return <div className="grid gap-2 border-t pt-3"><Label className="text-xs">{t('默认提供商')}</Label><ProviderSelect ariaLabel={t('默认提供商')} placeholder={t('选择默认提供商')} emptyLabel={t('未设置')} value={priorities.default_provider_id} providers={providers} excludedID={priorities.fallback_provider_id} onChange={(value) => update('default_provider_id', value)} /><Label className="text-xs">{t('故障回退')}</Label><ProviderSelect ariaLabel={t('故障回退')} placeholder={t('选择回退提供商')} emptyLabel={t('不使用回退')} value={priorities.fallback_provider_id} providers={providers} excludedID={priorities.default_provider_id} onChange={(value) => update('fallback_provider_id', value)} /><p className="text-[11px] text-muted-foreground">{keychainAvailable ? t('凭据保存到系统 Keychain。') : t('系统 Keychain 不可用，凭据仅保留到本次运行结束。')}</p></div>
}

function ProviderSelect({ ariaLabel, placeholder, emptyLabel, value, providers, excludedID, onChange }: { ariaLabel: string; placeholder: string; emptyLabel: string; value: number | null; providers: AIProviderProfile[]; excludedID: number | null; onChange: (value: string | null) => void }) {
  const selected = value !== null ? providers.find((profile) => profile.id === value) : undefined
  const selectedLabel = selected ? (selected.enabled ? selected.name : `${selected.name}（${t('未启用')}）`) : emptyLabel
  return <Select value={String(value ?? 'none')} onValueChange={onChange}><SelectTrigger aria-label={ariaLabel} className="w-full"><SelectValue placeholder={placeholder}><span>{selectedLabel}</span></SelectValue></SelectTrigger><SelectContent><SelectItem value="none">{emptyLabel}</SelectItem>{providers.map((profile) => <SelectItem key={profile.id} value={String(profile.id)} disabled={!profile.enabled || profile.id === excludedID}>{profile.name}{profile.enabled ? '' : `（${t('未启用')}）`}</SelectItem>)}</SelectContent></Select>
}

function ProviderEditorCard({ controller, model, catalog }: { controller: AISettingsController; model: AIProviderPanelRuntime; catalog: ReturnType<typeof useModelsDevCatalog> }) {
  const editing = model.draft.id !== 0
  if (!editing && !model.creating) {
    return <Card className="min-w-0 shadow-sm"><CardHeader><CardTitle className="text-sm">{t('提供商详情')}</CardTitle></CardHeader><CardContent><ProviderEmptyState /></CardContent></Card>
  }
  return <Card className="min-w-0 shadow-sm"><CardHeader><CardTitle className="text-sm">{editing ? t('编辑提供商') : t('新增提供商')}</CardTitle></CardHeader><CardContent className="grid gap-4"><ProviderFields model={model} catalog={catalog} /><ProviderActions controller={controller} model={model} /></CardContent></Card>
}

function ProviderEmptyState() {
  return <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
    <p className="text-sm text-muted-foreground">{t('从左侧选择一个提供商进行查看或编辑，或点击「新增提供商」创建新的提供商。')}</p>
  </div>
}

function ProviderFields({ model, catalog }: { model: AIProviderPanelRuntime; catalog: ReturnType<typeof useModelsDevCatalog> }) {
  const update = model.updateDraft
  const selectedModel = selectedCatalogModel(catalog.catalog, model.draft)
  return <><AIProviderCatalogFields {...catalog} draft={model.draft} update={update} /><div className="grid gap-3 sm:grid-cols-2"><Field label={t('名称')}><Input aria-label={t('名称')} value={model.draft.name} onChange={(event) => update((current) => ({ ...current, name: event.target.value }))} placeholder={t('例如：主模型')} /></Field><Field label={t('类型')}><Select value={model.draft.provider} onValueChange={(value) => update((current) => ({ ...current, provider: value as AIProviderType, base_url: defaultBaseURL(value as ProviderKind) }))}><SelectTrigger aria-label={t('类型')} className="w-full"><SelectValue><span>{providerTypeLabel(model.draft.provider)}</span></SelectValue></SelectTrigger><SelectContent>{Object.entries(providerLabels).map(([value, label]) => <SelectItem key={value} value={value}>{t(label)}</SelectItem>)}</SelectContent></Select></Field></div><Field label="Base URL"><Input aria-label="Base URL" value={model.draft.base_url} onChange={(event) => update((current) => ({ ...current, base_url: event.target.value }))} placeholder="https://api.openai.com/v1" /></Field><div className="grid gap-3 sm:grid-cols-2"><Field label={t('默认模型')}><Input aria-label={t('默认模型')} value={model.draft.default_model} onChange={(event) => update((current) => ({ ...current, default_model: event.target.value }))} placeholder={t('模型名称')} /></Field><Field label={model.draft.id && model.selected?.credential_saved ? t('API Key（已保存，留空保持不变）') : 'API Key'}><Input aria-label="API Key" type="password" value={model.draft.api_key} onChange={(event) => update((current) => ({ ...current, api_key: event.target.value }))} autoComplete="new-password" /></Field></div><AIProviderAdvancedFields draft={model.draft} update={model.updateDraft} model={selectedModel} /><label className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"><span>{t('启用此提供商')}</span><Switch checked={model.draft.enabled} onCheckedChange={(enabled) => update((current) => ({ ...current, enabled }))} /></label></>
}

function ProviderActions({ controller, model }: { controller: AISettingsController; model: AIProviderPanelRuntime }) {
  const busy = controller.pending !== null || model.saving || model.deleting || model.testing
  return <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={!model.draft.id || busy} onClick={() => { void model.testSelected().catch(() => undefined) }}><FlaskConical data-icon="inline-start" />{t('测试连接')}</Button><Button variant="outline" disabled={!model.draft.id || busy} onClick={() => { void model.deleteSelected().catch(() => undefined) }}><Trash2 data-icon="inline-start" />{t('删除')}</Button><Button disabled={busy} onClick={() => { void model.save().catch(() => undefined) }}><Save data-icon="inline-start" />{t('保存提供商')}</Button></div>
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <div className="grid gap-1.5"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div> }

function defaultBaseURL(provider: ProviderKind): string {
  return ({ openai_compatible: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com', gemini: 'https://generativelanguage.googleapis.com', ollama: 'http://127.0.0.1:11434' })[provider]
}
