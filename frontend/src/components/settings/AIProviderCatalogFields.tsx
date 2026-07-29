import { LoaderCircle, RefreshCw } from 'lucide-react'
import type { AIProviderProfileInput, ModelsDevCatalog, ModelsDevModel, ModelsDevProvider } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList,
} from '@/components/ui/combobox'
import { Label } from '@/components/ui/label'
import { applyModelPreset, applyProviderPreset, selectedCatalogProvider } from '@/components/settings/aiModelsDevCatalog'
import { t } from '@/i18n'

type Updater = (update: (current: AIProviderProfileInput) => AIProviderProfileInput) => void

interface Props {
  catalog: ModelsDevCatalog | null
  loading: boolean
  error: string | null
  draft: AIProviderProfileInput
  update: Updater
  refresh: () => Promise<void>
}

export function AIProviderCatalogFields(props: Props) {
  const providers = props.catalog?.providers ?? []
  const provider = selectedCatalogProvider(props.catalog, props.draft)
  const models = provider?.models ?? []
  return <div className="grid gap-3 rounded-lg border border-border bg-muted/20 p-3 sm:grid-cols-2">
    <CatalogField label={t('models.dev 提供商')}>
      <Combobox items={providers} value={provider ?? null} itemToStringLabel={(item) => item.name} itemToStringValue={(item) => item.id} isItemEqualToValue={(item, value) => item.id === value.id} filter={providerFilter} onValueChange={(selected) => {
        if (selected) props.update((draft) => applyProviderPreset(draft, selected))
      }}>
        <ComboboxInput aria-label={t('models.dev 提供商')} placeholder={props.loading ? t('正在加载 models.dev') : t('搜索提供商')} className="w-full" disabled={props.loading && providers.length === 0} />
        <ComboboxContent><ComboboxEmpty>{t('未找到提供商')}</ComboboxEmpty><ComboboxList>{(item) => <ComboboxItem key={item.id} value={item}><span className="font-medium">{item.name}</span><span className="ml-auto text-xs text-muted-foreground">{t('${} 个模型', item.models.length)}</span></ComboboxItem>}</ComboboxList></ComboboxContent>
      </Combobox>
    </CatalogField>
    <CatalogField label={t('models.dev 模型')}>
      <Combobox items={models} value={models.find((item) => item.id === props.draft.default_model) ?? null} itemToStringLabel={(item) => item.name} itemToStringValue={(item) => item.id} isItemEqualToValue={(item, value) => item.id === value.id} filter={modelFilter} onValueChange={(selected) => {
        if (selected) props.update((draft) => applyModelPreset(draft, selected))
      }}>
        <ComboboxInput aria-label={t('models.dev 模型')} placeholder={provider ? t('搜索模型') : t('先选择提供商')} className="w-full" disabled={!provider} />
        <ComboboxContent><ComboboxEmpty>{t('未找到模型')}</ComboboxEmpty><ComboboxList>{(item) => <ComboboxItem key={item.id} value={item}><span className="min-w-0"><span className="block truncate font-medium">{item.name}</span><span className="block truncate text-xs text-muted-foreground">{item.id}</span></span>{item.status ? <Badge variant="secondary" className="ml-auto">{item.status}</Badge> : null}</ComboboxItem>}</ComboboxList></ComboboxContent>
      </Combobox>
    </CatalogField>
    {(props.error || props.loading) ? <div className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-2" role="status">
      {props.loading ? <LoaderCircle className="size-3.5 animate-spin" /> : <span className="min-w-0 flex-1 truncate">{t('models.dev 加载失败: ${}', props.error ?? '')}</span>}
      {!props.loading && props.error ? <Button size="icon-xs" variant="ghost" aria-label={t('重新加载 models.dev')} onClick={() => { void props.refresh() }}><RefreshCw /></Button> : null}
    </div> : null}
  </div>
}

function catalogFilter(item: { id: string; name: string }, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase()
  return `${item.name} ${item.id}`.toLocaleLowerCase().includes(normalized)
}

function providerFilter(item: ModelsDevProvider, query: string): boolean { return catalogFilter(item, query) }

function modelFilter(item: ModelsDevModel, query: string): boolean { return catalogFilter(item, query) }

function CatalogField({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid min-w-0 gap-1.5"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>
}
