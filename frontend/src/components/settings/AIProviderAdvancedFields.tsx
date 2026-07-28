import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Plus, Trash2 } from 'lucide-react'
import { t } from '@/i18n'
import type { AIProviderProfileInput } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

type Draft = AIProviderProfileInput
type Updater = (fn: (current: Draft) => Draft) => void

export function AIProviderAdvancedFields({ draft, update }: { draft: Draft; update: Updater }) {
  const [expanded, setExpanded] = useState(false)
  const [headerKey, setHeaderKey] = useState('')
  const [headerValue, setHeaderValue] = useState('')
  return <div className="space-y-3 rounded-lg border border-border p-3">
    <button type="button" className="flex w-full items-center gap-1 text-sm font-medium" onClick={() => setExpanded((v) => !v)}>
      {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}{t('高级参数')}
    </button>
    {expanded ? <div className="space-y-3">
      <Field label={t('上下文窗口大小')}><Input aria-label={t('上下文窗口大小')} type="number" min={0} value={draft.context_window_size || ''} onChange={(e) => update((c) => ({ ...c, context_window_size: Number(e.target.value) || 0 }))} placeholder={t('留空使用默认值')} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('最大 Token 数')}><Input aria-label={t('最大 Token 数')} type="number" min={0} value={draft.max_tokens || ''} onChange={(e) => update((c) => ({ ...c, max_tokens: Number(e.target.value) || 0 }))} placeholder={t('留空使用默认值')} /></Field>
        <Field label="Temperature"><Input aria-label="Temperature" type="number" step="0.1" min={0} max={2} value={draft.temperature ?? ''} onChange={(e) => update((c) => ({ ...c, temperature: e.target.value === '' ? null : Number(e.target.value) }))} placeholder="0.0 - 2.0" /></Field>
        <Field label="Top P"><Input aria-label="Top P" type="number" step="0.1" min={0} max={1} value={draft.top_p ?? ''} onChange={(e) => update((c) => ({ ...c, top_p: e.target.value === '' ? null : Number(e.target.value) }))} placeholder="0.0 - 1.0" /></Field>
        <Field label={t('频率惩罚')}><Input aria-label={t('频率惩罚')} type="number" step="0.1" min={-2} max={2} value={draft.frequency_penalty ?? ''} onChange={(e) => update((c) => ({ ...c, frequency_penalty: e.target.value === '' ? null : Number(e.target.value) }))} placeholder="-2.0 - 2.0" /></Field>
        <Field label={t('存在惩罚')}><Input aria-label={t('存在惩罚')} type="number" step="0.1" min={-2} max={2} value={draft.presence_penalty ?? ''} onChange={(e) => update((c) => ({ ...c, presence_penalty: e.target.value === '' ? null : Number(e.target.value) }))} placeholder="-2.0 - 2.0" /></Field>
      </div>
      <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"><span>{t('跳过 TLS 证书校验')}</span><Switch checked={draft.skip_tls_verify} onCheckedChange={(v) => update((c) => ({ ...c, skip_tls_verify: v }))} /></label>
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">{t('自定义头信息')}</Label>
        {Object.entries(draft.custom_headers ?? {}).map(([key, value]) => <div key={key} className="flex items-center gap-2"><span className="flex-1 truncate text-xs font-mono" title={key}>{key}</span><span className="flex-1 truncate text-xs text-muted-foreground" title={value as string}>{value as string}</span><Button size="icon-xs" variant="ghost" aria-label={t('删除头信息')} onClick={() => update((c) => { const next = { ...c.custom_headers }; delete next[key]; return { ...c, custom_headers: next } })}><Trash2 /></Button></div>)}
        <div className="flex items-center gap-2"><Input aria-label={t('头信息名称')} value={headerKey} onChange={(e) => setHeaderKey(e.target.value)} placeholder={t('Header 名称')} /><Input aria-label={t('头信息值')} value={headerValue} onChange={(e) => setHeaderValue(e.target.value)} placeholder={t('Header 值')} /><Button size="sm" variant="outline" disabled={!headerKey.trim()} onClick={() => { if (headerKey.trim()) { update((c) => ({ ...c, custom_headers: { ...c.custom_headers, [headerKey.trim()]: headerValue } })); setHeaderKey(''); setHeaderValue('') } }}><Plus className="size-3.5" />{t('添加')}</Button></div>
      </div>
    </div> : null}
  </div>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="grid gap-1.5"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div> }
