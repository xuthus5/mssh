import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, FlaskConical, Plus, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { AIProviderType } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import type { AIProviderProfile, AIProviderProfileInput, AISettingsDashboard, AISettingsInput } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import type { AISettingsController } from '@/hooks/useAISettings'
import { requestConfirm } from '@/lib/confirmDialog'
import { t } from '@/i18n'


const providerLabels = { openai_compatible: 'OpenAI 兼容', anthropic: 'Anthropic', gemini: 'Gemini', ollama: 'Ollama' } as const
type ProviderKind = keyof typeof providerLabels

function emptyProvider(): AIProviderProfileInput {
  return { id: 0, name: '', provider: AIProviderType.AIProviderOpenAICompatible, base_url: 'https://api.openai.com/v1', default_model: '', enabled: true, api_key: '' }
}

function providerInput(profile: AIProviderProfile): AIProviderProfileInput {
  return { id: profile.id, name: profile.name, provider: profile.provider, base_url: profile.base_url, default_model: profile.default_model, enabled: profile.enabled, api_key: '' }
}

export function AIProviderPanel({ controller }: { controller: AISettingsController }) {
  const dashboard = controller.dashboard
  const [selectedID, setSelectedID] = useState(0)
  const [draft, setDraft] = useState<AIProviderProfileInput>(emptyProvider)
  const selected = useMemo(() => dashboard?.providers.find((item) => item.id === selectedID), [dashboard, selectedID])
  useEffect(() => {
    if (selected) setDraft(providerInput(selected))
    else if (selectedID === 0) setDraft(emptyProvider())
  }, [selected, selectedID])
  const selectProvider = (profile: AIProviderProfile) => setSelectedID(profile.id)
  const save = async () => { const saved = await controller.saveProvider(draft); if (saved) setSelectedID(saved.id) }
  const deleteSelected = async () => {
    if (!draft.id) return
    const ok = await requestConfirm({
      title: t('删除提供商'),
      description: t('确认删除提供商「${}」？此操作不可撤销。', draft.name || t('未命名提供商')),
      confirmLabel: t('删除'),
      cancelLabel: t('取消'),
      destructive: true,
    })
    if (!ok) return
    await controller.deleteProvider(draft.id)
    setSelectedID(0)
    setDraft(emptyProvider())
  }
  return <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(220px,0.8fr)_minmax(360px,1.5fr)]">
    <Card className="min-w-0 shadow-sm"><CardHeader className="flex-row items-center justify-between"><CardTitle className="text-sm">{t('提供商')}</CardTitle><Button size="icon-xs" variant="outline" aria-label={t('新增提供商')} onClick={() => { setSelectedID(0); setDraft(emptyProvider()) }}><Plus /></Button></CardHeader><CardContent className="space-y-2">
      {(dashboard?.providers ?? []).map((profile) => <button type="button" key={profile.id} onClick={() => selectProvider(profile)} className={`flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors ${selectedID === profile.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}><span className="min-w-0"><span className="block truncate text-sm font-medium">{profile.name}</span><span className="block truncate text-xs text-muted-foreground">{t(providerLabels[profile.provider as ProviderKind] ?? profile.provider)} · {profile.default_model}</span></span><span className="flex shrink-0 items-center gap-1">{profile.credential_saved && <Check className="size-3.5 text-emerald-600" />}{profile.id === dashboard?.settings.default_provider_id && <Badge variant="secondary">{t('默认')}</Badge>}</span></button>)}
      {(dashboard?.providers ?? []).length === 0 && <p className="py-8 text-center text-xs text-muted-foreground">{t('尚未配置提供商')}</p>}
      {dashboard && <div className="grid gap-2 border-t pt-3"><Label className="text-xs">{t('默认提供商')}</Label><Select value={String(dashboard.settings.default_provider_id ?? 'none')} onValueChange={(value) => { void controller.saveSettings({ ...settingsInput(dashboard), default_provider_id: value === 'none' ? null : Number(value) }).catch(() => undefined) }}><SelectTrigger aria-label={t('默认提供商')} className="w-full"><SelectValue placeholder={t('选择默认提供商')} /></SelectTrigger><SelectContent><SelectItem value="none">{t('未设置')}</SelectItem>{dashboard.providers.map((profile) => <SelectItem key={profile.id} value={String(profile.id)}>{profile.name}</SelectItem>)}</SelectContent></Select><Label className="text-xs">{t('故障回退')}</Label><Select value={String(dashboard.settings.fallback_provider_id ?? 'none')} onValueChange={(value) => { void controller.saveSettings({ ...settingsInput(dashboard), fallback_provider_id: value === 'none' ? null : Number(value) }).catch(() => undefined) }}><SelectTrigger aria-label={t('故障回退')} className="w-full"><SelectValue placeholder={t('选择回退提供商')} /></SelectTrigger><SelectContent><SelectItem value="none">{t('不使用回退')}</SelectItem>{dashboard.providers.map((profile) => <SelectItem key={profile.id} value={String(profile.id)}>{profile.name}</SelectItem>)}</SelectContent></Select><p className="text-[11px] text-muted-foreground">{dashboard.keychain_available ? t('凭据保存到系统 Keychain。') : t('系统 Keychain 不可用，凭据仅保留到本次运行结束。')}</p></div>}
    </CardContent></Card>
    <Card className="min-w-0 shadow-sm"><CardHeader><CardTitle className="text-sm">{draft.id ? t('编辑提供商') : t('新增提供商')}</CardTitle></CardHeader><CardContent className="grid gap-4"><div className="grid gap-3 sm:grid-cols-2"><Field label={t('名称')}><Input aria-label={t('名称')} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder={t('例如：主模型')} /></Field><Field label={t('类型')}><Select value={draft.provider} onValueChange={(value) => setDraft({ ...draft, provider: value as AIProviderType, base_url: defaultBaseURL(value as ProviderKind) })}><SelectTrigger aria-label={t('类型')} className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(providerLabels).map(([value, label]) => <SelectItem key={value} value={value}>{t(label)}</SelectItem>)}</SelectContent></Select></Field></div><Field label="Base URL"><Input aria-label="Base URL" value={draft.base_url} onChange={(event) => setDraft({ ...draft, base_url: event.target.value })} placeholder="https://api.openai.com/v1" /></Field><div className="grid gap-3 sm:grid-cols-2"><Field label={t('默认模型')}><Input aria-label={t('默认模型')} value={draft.default_model} onChange={(event) => setDraft({ ...draft, default_model: event.target.value })} placeholder={t('模型名称')} /></Field><Field label={draft.id && selected?.credential_saved ? t('API Key（已保存，留空保持不变）') : 'API Key'}><Input aria-label="API Key" type="password" value={draft.api_key} onChange={(event) => setDraft({ ...draft, api_key: event.target.value })} autoComplete="new-password" /></Field></div><label className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"><span>{t('启用此提供商')}</span><Switch checked={draft.enabled} onCheckedChange={(enabled) => setDraft({ ...draft, enabled })} /></label><div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={!draft.id || controller.pending !== null} onClick={() => { void controller.testProvider(draft.id).catch(() => undefined) }}><FlaskConical data-icon="inline-start" />{t('测试连接')}</Button><Button variant="outline" disabled={!draft.id || controller.pending !== null} onClick={() => { void deleteSelected().catch(() => undefined) }}><Trash2 data-icon="inline-start" />{t('删除')}</Button><Button disabled={controller.pending !== null} onClick={() => { void save().catch(() => undefined) }}><Save data-icon="inline-start" />{t('保存提供商')}</Button></div></CardContent></Card>
  </div>
}

function settingsInput(dashboard: AISettingsDashboard): AISettingsInput {
  return { default_provider_id: dashboard.settings.default_provider_id, fallback_provider_id: dashboard.settings.fallback_provider_id, interaction: dashboard.settings.interaction, search: { enabled: dashboard.settings.search.enabled, mode: dashboard.settings.search.mode, provider: dashboard.settings.search.provider, timeout_seconds: dashboard.settings.search.timeout_seconds, max_results: dashboard.settings.search.max_results, require_citations: dashboard.settings.search.require_citations, api_key: '' }, security: dashboard.settings.security }
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <div className="grid gap-1.5"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div> }

function defaultBaseURL(provider: ProviderKind): string {
  return ({ openai_compatible: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com', gemini: 'https://generativelanguage.googleapis.com', ollama: 'http://127.0.0.1:11434' })[provider]
}
