import { FolderCog, Tags, X } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { LabeledSelect } from '@/components/ui/labeled-select'
import type { AssetTag } from '@/hooks/useSession'
import { useEffect, useState } from 'react'
import { t } from '@/i18n'
import { useBulkAssetDialog, type BulkAssetOptions, type BulkKind, type TagOperation } from '@/components/session/useBulkAssetDialog'


type Props = BulkAssetOptions

export function SessionAssetBulkBar(props: Props) {
  const [kind, setKind] = useState<BulkKind | null>(null)
  useEffect(() => {
    if (props.selectedIDs.length === 0) setKind(null)
  }, [props.selectedIDs.length])
  if (props.selectedIDs.length === 0) return null
  return <>
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/40 p-2 shadow-sm">
      <Badge>{props.selectedIDs.length} {t('个会话')}</Badge><span className="text-xs text-muted-foreground">{t('批量设置资产归属')}</span>
      <div className="ml-auto flex items-center gap-1"><Button type="button" size="sm" variant="outline" onClick={() => setKind('environment')}><FolderCog data-icon="inline-start" />{t('环境')}</Button><Button type="button" size="sm" variant="outline" onClick={() => setKind('project')}>{t('项目')}</Button><Button type="button" size="sm" variant="outline" onClick={() => setKind('tags')}><Tags data-icon="inline-start" />{t('标签')}</Button><Button type="button" size="icon-sm" variant="ghost" aria-label={t('取消批量选择')} onClick={props.onClearSelection}><X /></Button></div>
    </div>
    <BulkAssetDialog {...props} kind={kind} onOpenChange={(open) => { if (!open) setKind(null) }} />
  </>
}

function BulkAssetDialog({ kind, selectedIDs, environments, projects, tags, onSetEnvironment, onSetProject, onUpdateTags, onClearSelection, onOpenChange }: Props & { kind: BulkKind | null; onOpenChange: (open: boolean) => void }) {
  const dialog = useBulkAssetDialog({ kind, selectedIDs, environments, projects, tags, onSetEnvironment, onSetProject, onUpdateTags, onClearSelection, onOpenChange })
  const title = kind === 'environment' ? t('批量设置环境') : kind === 'project' ? t('批量设置项目') : t('批量更新标签')
  const options = kind === 'environment'
    ? [{ value: '', label: t('清空环境') }, ...environments.map((item) => ({ value: item.id, label: item.name }))]
    : [{ value: '', label: t('清空项目') }, ...projects.map((item) => ({ value: item.id, label: item.code ? `${item.code} · ${item.name}` : item.name }))]
  return <Dialog open={kind !== null} onOpenChange={dialog.handleOpenChange}><DialogContent showCloseButton={!dialog.pending}><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{t('本次操作将影响')} {selectedIDs.length} {t('个会话，并在单个事务中提交。')}</DialogDescription></DialogHeader>
    {dialog.error && <Alert variant="destructive"><AlertDescription>{dialog.error}</AlertDescription></Alert>}
    {kind === 'tags' ? <TagBulkFields disabled={dialog.pending} tags={tags} operation={dialog.operation} tagIDs={dialog.tagIDs} onOperationChange={dialog.setOperation} onTagIDsChange={dialog.setTagIDs} /> : <LabeledSelect disabled={dialog.pending} ariaLabel={title} value={dialog.targetID} options={options} onValueChange={dialog.setTargetID} />}
    <DialogFooter><Button type="button" variant="outline" disabled={dialog.pending} onClick={() => dialog.handleOpenChange(false)}>{t('取消')}</Button><Button type="button" disabled={dialog.pending || (kind === 'tags' && dialog.operation !== 'replace' && dialog.tagIDs.length === 0)} onClick={() => { void dialog.submit() }}>{dialog.pending ? t('处理中…') : t('确认更新 ${} 个会话', selectedIDs.length)}</Button></DialogFooter>
  </DialogContent></Dialog>
}

function TagBulkFields({ disabled, tags, operation, tagIDs, onOperationChange, onTagIDsChange }: { disabled: boolean; tags: AssetTag[]; operation: TagOperation; tagIDs: string[]; onOperationChange: (operation: TagOperation) => void; onTagIDsChange: (ids: string[]) => void }) {
  return <div className="flex flex-col gap-3">
    <LabeledSelect disabled={disabled} ariaLabel={t('标签批量操作')} value={operation} options={[{ value: 'add', label: t('添加标签') }, { value: 'remove', label: t('移除标签') }, { value: 'replace', label: t('完全替换标签') }]} onValueChange={(value) => onOperationChange(value as TagOperation)} />
    <DropdownMenu><DropdownMenuTrigger render={<Button type="button" variant="outline" disabled={disabled} className="justify-start font-normal" />}><Tags data-icon="inline-start" />{tagIDs.length > 0 ? t('已选择 ${} 个标签', tagIDs.length) : operation === 'replace' ? t('不选标签将清空全部标签') : t('选择标签')}</DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-64"><DropdownMenuGroup>{tags.length === 0 ? <div className="p-3 text-xs text-muted-foreground">{t('暂无标签')}</div> : tags.map((tag) => <DropdownMenuCheckboxItem key={tag.id} disabled={disabled} checked={tagIDs.includes(tag.id)} onCheckedChange={(checked) => onTagIDsChange(checked ? [...tagIDs, tag.id] : tagIDs.filter((id) => id !== tag.id))}>{tag.name}</DropdownMenuCheckboxItem>)}</DropdownMenuGroup></DropdownMenuContent>
    </DropdownMenu>
    {tagIDs.length > 0 && <div className="flex flex-wrap gap-1">{tags.filter((tag) => tagIDs.includes(tag.id)).map((tag) => <Badge key={tag.id} variant="outline" data-asset-color={tag.colorToken} className="asset-color-badge">{tag.name}</Badge>)}</div>}
  </div>
}
