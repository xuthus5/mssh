import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import type { AIProviderProfileInput, ModelsDevModel } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { t } from '@/i18n'

type Draft = AIProviderProfileInput
type Updater = (fn: (current: Draft) => Draft) => void

interface Props {
  draft: Draft
  update: Updater
  model?: ModelsDevModel
}

export function AIProviderAdvancedFields({ draft, update, model }: Props) {
  const [expanded, setExpanded] = useState(false)
  return <div className="space-y-3 rounded-lg border border-border p-3">
    <button type="button" className="flex w-full items-center gap-1 text-sm font-medium" onClick={() => setExpanded((value) => !value)}>
      {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}{t('高级参数')}
    </button>
    {expanded ? <div className="space-y-3">
      <ParameterFields draft={draft} update={update} model={model} />
      <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
        <span>{t('跳过 TLS 证书校验')}</span><Switch checked={draft.skip_tls_verify} onCheckedChange={(value) => update((current) => ({ ...current, skip_tls_verify: value }))} />
      </label>
      <HeaderFields draft={draft} update={update} />
    </div> : null}
  </div>
}

function ParameterFields({ draft, update, model }: Props) {
  const temperatureDisabled = model?.temperature_supported === false
  return <div className="grid gap-3 sm:grid-cols-2">
    <NumericPresetField label={t('上下文窗口大小')} value={draft.context_window_size} recommended={model?.context_window_size} presets={[8192, 32768, 65536, 128000, 200000]} onChange={(value) => update((current) => ({ ...current, context_window_size: value ?? 0 }))} />
    <NumericPresetField label={t('最大 Token 数')} value={draft.max_tokens} recommended={model?.max_tokens} presets={[1024, 2048, 4096, 8192, 16384, 32768]} onChange={(value) => update((current) => ({ ...current, max_tokens: value ?? 0 }))} />
    <NumericPresetField label="Temperature" value={draft.temperature} presets={[0, 0.2, 0.7, 1]} nullable disabled={temperatureDisabled} onChange={(value) => update((current) => ({ ...current, temperature: value }))} />
    <NumericPresetField label="Top P" value={draft.top_p} presets={[0.5, 0.8, 0.9, 1]} nullable onChange={(value) => update((current) => ({ ...current, top_p: value }))} />
    <NumericPresetField label={t('频率惩罚')} value={draft.frequency_penalty} presets={[-1, -0.5, 0, 0.5, 1]} nullable onChange={(value) => update((current) => ({ ...current, frequency_penalty: value }))} />
    <NumericPresetField label={t('存在惩罚')} value={draft.presence_penalty} presets={[-1, -0.5, 0, 0.5, 1]} nullable onChange={(value) => update((current) => ({ ...current, presence_penalty: value }))} />
    {temperatureDisabled ? <p className="text-xs text-muted-foreground sm:col-span-2">{t('该模型不支持 Temperature')}</p> : null}
  </div>
}

interface NumericPresetProps {
  label: string
  value: number | null
  presets: number[]
  recommended?: number
  nullable?: boolean
  disabled?: boolean
  onChange: (value: number | null) => void
}

function NumericPresetField(props: NumericPresetProps) {
  const options = useMemo(() => numericOptions(props.presets, props.recommended, props.nullable), [props.nullable, props.presets, props.recommended])
  const selected = optionKey(props.value, options, props.nullable)
  return <div className="grid gap-1.5">
    <Label className="text-xs text-muted-foreground">{props.label}</Label>
    <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] gap-2">
      <Input aria-label={props.label} type="number" step="any" value={props.value ?? ''} disabled={props.disabled} onChange={(event) => props.onChange(event.target.value === '' ? (props.nullable ? null : 0) : Number(event.target.value))} placeholder={t('使用默认值')} />
      <Select value={selected} disabled={props.disabled} onValueChange={(key) => {
        const option = options.find((item) => item.key === key)
        if (option) props.onChange(option.value)
      }}>
        <SelectTrigger aria-label={t('${} 快速选择', props.label)} className="w-full"><SelectValue><span>{options.find((option) => option.key === selected)?.label ?? selected}</span></SelectValue></SelectTrigger>
        <SelectContent>{options.map((option) => <SelectItem key={option.key} value={option.key}>{option.label}</SelectItem>)}<SelectItem value="custom" disabled>{t('自定义')}</SelectItem></SelectContent>
      </Select>
    </div>
  </div>
}

interface NumericOption { key: string; value: number | null; label: string }

function numericOptions(presets: number[], recommended?: number, nullable?: boolean): NumericOption[] {
  const values = [...new Set([...(recommended && recommended > 0 ? [recommended] : []), ...presets])]
  const options: NumericOption[] = values.map((value) => ({ key: String(value), value, label: value === recommended ? t('模型值 ${}', formatNumber(value)) : formatNumber(value) }))
  if (nullable) options.unshift({ key: 'default', value: null, label: t('默认值') })
  return options
}

function optionKey(value: number | null, options: NumericOption[], nullable?: boolean): string {
  if (value === null && nullable) return 'default'
  return options.some((option) => option.value === value) ? String(value) : 'custom'
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString('en-US') : String(value)
}

function HeaderFields({ draft, update }: Pick<Props, 'draft' | 'update'>) {
  const [headerKey, setHeaderKey] = useState('')
  const [headerValue, setHeaderValue] = useState('')
  const addHeader = () => {
    const key = headerKey.trim()
    if (!key) return
    update((current) => ({ ...current, custom_headers: { ...current.custom_headers, [key]: headerValue } }))
    setHeaderKey('')
    setHeaderValue('')
  }
  return <div className="space-y-2">
    <Label className="text-xs text-muted-foreground">{t('自定义头信息')}</Label>
    {Object.entries(draft.custom_headers ?? {}).map(([key, value]) => <div key={key} className="flex items-center gap-2">
      <span className="flex-1 truncate font-mono text-xs" title={key}>{key}</span><span className="flex-1 truncate text-xs text-muted-foreground" title={value}>{value}</span>
      <Button size="icon-xs" variant="ghost" aria-label={t('删除头信息')} onClick={() => update((current) => { const next = { ...current.custom_headers }; delete next[key]; return { ...current, custom_headers: next } })}><Trash2 /></Button>
    </div>)}
    <div className="flex items-center gap-2">
      <Input aria-label={t('头信息名称')} value={headerKey} onChange={(event) => setHeaderKey(event.target.value)} placeholder={t('Header 名称')} />
      <Input aria-label={t('头信息值')} value={headerValue} onChange={(event) => setHeaderValue(event.target.value)} placeholder={t('Header 值')} />
      <Button size="sm" variant="outline" disabled={!headerKey.trim()} onClick={addHeader}><Plus className="size-3.5" />{t('添加')}</Button>
    </div>
  </div>
}
