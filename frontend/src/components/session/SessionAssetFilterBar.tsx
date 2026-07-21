import { Filter, RotateCcw, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import type { AssetEnvironment, AssetProject, AssetTag } from '@/hooks/useSession'
import { activeSessionAssetFilterCount, type SessionAssetFilters } from '@/lib/sessionAssetSearch'
import { t } from '@/i18n'


interface Props {
  filters: SessionAssetFilters
  environments: AssetEnvironment[]
  projects: AssetProject[]
  tags: AssetTag[]
  onChange: (updates: Partial<SessionAssetFilters>) => void
  onReset: () => void
}

export function SessionAssetFilterBar({ filters, environments, projects, tags, onChange, onReset }: Props) {
  const count = activeSessionAssetFilterCount(filters)
  return <div className="flex flex-col gap-2">
    <div className="flex flex-wrap items-center gap-2">
      <Input aria-label={t('搜索所有节点')} value={filters.query} onChange={(event) => onChange({ query: event.target.value })}
        placeholder={t('搜索名称、主机、用户、分组或资产')} className="min-w-64 flex-1" />
      <Popover><PopoverTrigger render={<Button type="button" variant="outline" />}><Filter data-icon="inline-start" />{t('高级筛选')}{count > 0 && <Badge variant="secondary">{count}</Badge>}</PopoverTrigger>
        <PopoverContent align="end" className="max-h-[70vh] w-[36rem] overflow-y-auto p-4">
          <PopoverHeader><PopoverTitle>{t('高级筛选')}</PopoverTitle><PopoverDescription>{t('同类条件取并集，不同类别取交集。')}</PopoverDescription></PopoverHeader>
          <div className="grid grid-cols-3 gap-4">
            <FilterOptions title={t('环境')} items={environments} selected={filters.environmentIds} onChange={(environmentIds) => onChange({ environmentIds })} />
            <FilterOptions title={t('项目')} items={projects} selected={filters.projectIds} onChange={(projectIds) => onChange({ projectIds })} />
            <FilterOptions title={t('标签')} items={tags} selected={filters.tagIds} onChange={(tagIds) => onChange({ tagIds })} />
          </div>
          <Separator />
          <div className="grid grid-cols-3 gap-3">
            <CheckFilter label={t('未设置环境')} checked={filters.includeUnsetEnvironment} onChange={(includeUnsetEnvironment) => onChange({ includeUnsetEnvironment })} />
            <CheckFilter label={t('未关联项目')} checked={filters.includeUnsetProject} onChange={(includeUnsetProject) => onChange({ includeUnsetProject })} />
            <CheckFilter label={t('无标签')} checked={filters.includeUntagged} onChange={(includeUntagged) => onChange({ includeUntagged })} />
          </div>
          <Separator />
          <div className="grid grid-cols-2 gap-3">
            <FilterInput label={t('最近连接起始')} type="datetime-local" value={filters.connectedAfter} onChange={(connectedAfter) => onChange({ connectedAfter })} />
            <FilterInput label={t('最近连接截止')} type="datetime-local" value={filters.connectedBefore} onChange={(connectedBefore) => onChange({ connectedBefore })} />
            <FilterInput label={t('最少连接次数')} type="number" value={filters.minConnections ?? ''} onChange={(value) => onChange({ minConnections: optionalNumber(value) })} />
            <FilterInput label={t('最多连接次数')} type="number" value={filters.maxConnections ?? ''} onChange={(value) => onChange({ maxConnections: optionalNumber(value) })} />
          </div>
          <FilterInput label={t('备注关键词（仅显式筛选时匹配）')} value={filters.notesQuery} onChange={(notesQuery) => onChange({ notesQuery })} />
          <Button type="button" variant="ghost" className="self-end" disabled={count === 0} onClick={onReset}><RotateCcw data-icon="inline-start" />{t('重置筛选')}</Button>
        </PopoverContent>
      </Popover>
    </div>
    <FilterChips filters={filters} environments={environments} projects={projects} tags={tags} onChange={onChange} onReset={onReset} />
  </div>
}

function FilterOptions({ title, items, selected, onChange }: { title: string; items: { id: string; name: string }[]; selected: string[]; onChange: (ids: string[]) => void }) {
  return <fieldset className="flex min-w-0 flex-col gap-2"><legend className="text-xs font-semibold text-foreground">{title}</legend>
    <div className="flex max-h-36 flex-col gap-2 overflow-y-auto rounded-lg border border-border p-2">
      {items.length === 0 && <span className="text-xs text-muted-foreground">{t('暂无可选项')}</span>}
      {items.map((item) => <label key={item.id} className="flex cursor-pointer items-center gap-2 text-xs"><Checkbox checked={selected.includes(item.id)} onCheckedChange={(checked) => onChange(checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))} /><span className="truncate">{item.name}</span></label>)}
    </div>
  </fieldset>
}

function CheckFilter({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border p-2 text-xs"><Checkbox checked={checked} onCheckedChange={onChange} />{label}</label>
}

function FilterInput({ label, type = 'text', value, onChange }: { label: string; type?: string; value: string | number; onChange: (value: string) => void }) {
  return <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">{label}<Input type={type} min={type === 'number' ? 0 : undefined} value={value} onChange={(event) => onChange(event.target.value)} /></label>
}

function FilterChips({ filters, environments, projects, tags, onChange, onReset }: Props) {
  const chips = buildFilterChips(filters, environments, projects, tags)
  if (chips.length === 0) return null
  return <div aria-label={t('当前筛选条件')} className="flex flex-wrap items-center gap-1.5">{chips.map((chip) => <Badge key={chip.key} variant="outline" className="gap-1">{chip.label}<button type="button" aria-label={t('移除筛选 ${}', chip.label)} onClick={() => onChange(chip.clear)}><X /></button></Badge>)}<Button type="button" variant="ghost" size="xs" onClick={onReset}>{t('全部清除')}</Button></div>
}

export function buildFilterChips(filters: SessionAssetFilters, environments: AssetEnvironment[], projects: AssetProject[], tags: AssetTag[]) {
  const chips: { key: string; label: string; clear: Partial<SessionAssetFilters> }[] = []
  if (filters.query.trim()) chips.push({ key: 'query', label: t('搜索：${}', filters.query.trim()), clear: { query: '' } })
  appendSelectionChips(chips, 'environment', t('环境'), filters.environmentIds, environments, { environmentIds: [] })
  appendSelectionChips(chips, 'project', t('项目'), filters.projectIds, projects, { projectIds: [] })
  appendSelectionChips(chips, 'tag', t('标签'), filters.tagIds, tags, { tagIds: [] })
  if (filters.includeUnsetEnvironment) chips.push({ key: 'unset-environment', label: t('未设置环境'), clear: { includeUnsetEnvironment: false } })
  if (filters.includeUnsetProject) chips.push({ key: 'unset-project', label: t('未关联项目'), clear: { includeUnsetProject: false } })
  if (filters.includeUntagged) chips.push({ key: 'untagged', label: t('无标签'), clear: { includeUntagged: false } })
  if (filters.notesQuery.trim()) chips.push({ key: 'notes', label: t('备注：${}', filters.notesQuery.trim()), clear: { notesQuery: '' } })
  if (filters.connectedAfter) chips.push({ key: 'after', label: t('连接始于 ${}', filters.connectedAfter), clear: { connectedAfter: '' } })
  if (filters.connectedBefore) chips.push({ key: 'before', label: t('连接止于 ${}', filters.connectedBefore), clear: { connectedBefore: '' } })
  if (filters.minConnections !== null) chips.push({ key: 'min', label: t('连接 ≥ ${}', filters.minConnections), clear: { minConnections: null } })
  if (filters.maxConnections !== null) chips.push({ key: 'max', label: t('连接 ≤ ${}', filters.maxConnections), clear: { maxConnections: null } })
  return chips
}

function appendSelectionChips(chips: ReturnType<typeof buildFilterChips>, key: string, label: string, ids: string[], items: { id: string; name: string }[], clear: Partial<SessionAssetFilters>) {
  if (ids.length === 0) return
  const names = ids.map((id) => items.find((item) => item.id === id)?.name ?? id).join('、')
  chips.push({ key, label: `${label}：${names}`, clear })
}

function optionalNumber(value: string) {
  if (value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}
