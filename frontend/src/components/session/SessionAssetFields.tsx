import { useState } from 'react'
import { Plus, Tags, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { Textarea } from '@/components/ui/textarea'
import type { AssetColorToken, AssetEnvironment, AssetProject, AssetTag } from '@/lib/sessionModels'
import { ASSET_COLOR_OPTIONS } from '@/lib/assetColors'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'


interface Props {
  environments: AssetEnvironment[]
  projects: AssetProject[]
  tags: AssetTag[]
  environmentId: string
  projectId: string
  tagIds: string[]
  notes: string
  onEnvironmentChange: (id: string) => void
  onProjectChange: (id: string) => void
  onTagIdsChange: (ids: string[]) => void
  onNotesChange: (notes: string) => void
  onCreateEnvironment: (name: string, color: AssetColorToken) => Promise<AssetEnvironment>
  onCreateProject: (name: string, code: string) => Promise<AssetProject>
  onCreateTag: (name: string, color: AssetColorToken) => Promise<AssetTag>
}

export function SessionAssetFields(props: Props) {
  const [createKind, setCreateKind] = useState<'environment' | 'project' | 'tag' | null>(null)
  const environmentOptions = [{ value: '', label: t('未设置环境') }, ...props.environments.map((item) => ({ value: item.id, label: item.name }))]
  const projectOptions = [{ value: '', label: t('未关联项目') }, ...props.projects.map((item) => ({ value: item.id, label: item.code ? `${item.code} · ${item.name}` : item.name }))]
  const selectedTags = props.tags.filter((tag) => props.tagIds.includes(tag.id))
  return <>
    <div className="grid grid-cols-2 gap-3">
      <AssetSelect label={t('环境')} value={props.environmentId} options={environmentOptions} onChange={props.onEnvironmentChange} onCreate={() => setCreateKind('environment')} />
      <AssetSelect label={t('项目')} value={props.projectId} options={projectOptions} onChange={props.onProjectChange} onCreate={() => setCreateKind('project')} />
    </div>
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">{t('标签')}</span><Button type="button" size="xs" variant="ghost" onClick={() => setCreateKind('tag')}><Plus data-icon="inline-start" />{t('新建标签')}</Button></div>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="outline" className="justify-start font-normal" />}><Tags data-icon="inline-start" />{selectedTags.length > 0 ? t('已选择 ${} 个标签', selectedTags.length) : t('选择标签')}</DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-56"><DropdownMenuGroup>{props.tags.length === 0 ? <div className="px-2 py-3 text-xs text-muted-foreground">{t('暂无标签，请先创建。')}</div> : props.tags.map((tag) => <DropdownMenuCheckboxItem key={tag.id} checked={props.tagIds.includes(tag.id)} onCheckedChange={(checked) => props.onTagIdsChange(checked ? [...props.tagIds, tag.id] : props.tagIds.filter((id) => id !== tag.id))}>{tag.name}</DropdownMenuCheckboxItem>)}</DropdownMenuGroup></DropdownMenuContent>
      </DropdownMenu>
      {selectedTags.length > 0 && <div className="flex flex-wrap gap-1.5">{selectedTags.map((tag) => <Badge key={tag.id} variant="outline" data-asset-color={tag.colorToken} className="asset-color-badge gap-1">{tag.name}<button type="button" aria-label={t('移除标签 ${}', tag.name)} onClick={() => props.onTagIdsChange(props.tagIds.filter((id) => id !== tag.id))}><X className="size-3" /></button></Badge>)}</div>}
    </div>
    <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">{t('备注')}</span><Textarea value={props.notes} maxLength={2000} onChange={(event) => props.onNotesChange(event.target.value)} placeholder={t('记录用途、负责人或注意事项')} rows={2} /></label>
    <QuickCreateDialog kind={createKind} onOpenChange={(open) => { if (!open) setCreateKind(null) }} onCreateEnvironment={props.onCreateEnvironment} onCreateProject={props.onCreateProject} onCreateTag={props.onCreateTag} onCreated={(id) => { if (createKind === 'environment') props.onEnvironmentChange(id); else if (createKind === 'project') props.onProjectChange(id); else props.onTagIdsChange([...props.tagIds, id]); setCreateKind(null) }} />
  </>
}

function AssetSelect({ label, value, options, onChange, onCreate }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; onCreate: () => void }) {
  return <div className="flex flex-col gap-1.5"><div className="flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">{label}</span><Button type="button" size="xs" variant="ghost" onClick={onCreate}><Plus data-icon="inline-start" />{t('新建')}</Button></div><LabeledSelect ariaLabel={label} value={value} options={options} onValueChange={onChange} /></div>
}

function QuickCreateDialog({ kind, onOpenChange, onCreated, onCreateEnvironment, onCreateProject, onCreateTag }: { kind: 'environment' | 'project' | 'tag' | null; onOpenChange: (open: boolean) => void; onCreated: (id: string) => void; onCreateEnvironment: Props['onCreateEnvironment']; onCreateProject: Props['onCreateProject']; onCreateTag: Props['onCreateTag'] }) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [color, setColor] = useState<AssetColorToken>('slate')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const create = async () => {
    setPending(true); setError('')
    try {
      const created = kind === 'environment' ? await onCreateEnvironment(name, color) : kind === 'project' ? await onCreateProject(name, code) : await onCreateTag(name, color)
      onCreated(created.id); setName(''); setCode(''); setColor('slate')
    } catch (reason) { const message = reason instanceof Error ? reason.message : String(reason); setError(message); toast(t('创建资产失败: ${}', message), 'error') }
    finally { setPending(false) }
  }
  const title = kind === 'environment' ? t('新建环境') : kind === 'project' ? t('新建项目') : t('新建标签')
  return <Dialog open={kind !== null} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-sm"><DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader><div className="flex flex-col gap-3">{error && <p role="alert" className="text-xs text-destructive">{error}</p>}<label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">{t('名称')}</span><Input value={name} maxLength={kind === 'tag' ? 32 : 64} onChange={(event) => setName(event.target.value)} autoFocus /></label>{kind === 'project' ? <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">{t('项目代号（可选）')}</span><Input value={code} maxLength={24} onChange={(event) => setCode(event.target.value)} /></label> : <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">{t('颜色')}</span><LabeledSelect value={color} options={ASSET_COLOR_OPTIONS} onValueChange={(value) => setColor(value as AssetColorToken)} /></label>}</div><DialogFooter><Button type="button" disabled={pending || !name.trim()} onClick={() => { void create() }}>{pending ? t('创建中…') : t('创建')}</Button></DialogFooter></DialogContent></Dialog>
}
