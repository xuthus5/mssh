import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { Textarea } from '@/components/ui/textarea'
import type { AssetColorToken, AssetTag } from '@/hooks/useSession'
import { getAssetColorOptions } from '@/lib/assetColors'
import { t } from '@/i18n'
import {
  useCatalogDeleteDialog,
  useCatalogEditorDialog,
  type CatalogDeleteProps,
  type CatalogEditorProps,
} from '@/components/session/sessionAssetCatalogDialogState'

export type { CatalogDeleteTarget, CatalogEditorTarget, CatalogItem, CatalogKind } from '@/components/session/sessionAssetCatalogDialogState'


export function SessionAssetCatalogEditor(props: CatalogEditorProps) {
  const { target } = props
  const editor = useCatalogEditorDialog(props)
  const noun = target?.kind === 'environment' ? t('环境') : target?.kind === 'project' ? t('项目') : t('标签')
  return <Dialog open={Boolean(target)} onOpenChange={editor.handleOpenChange}><DialogContent><DialogHeader><DialogTitle>{target?.item ? t('编辑') : t('新建')}{noun}</DialogTitle><DialogDescription>{t('名称会在会话列表、搜索和详情中即时生效。')}</DialogDescription></DialogHeader>
    {editor.error && <Alert variant="destructive"><AlertDescription>{editor.error}</AlertDescription></Alert>}
    <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">{t('名称')}<Input autoFocus disabled={editor.pending} value={editor.name} maxLength={target?.kind === 'tag' ? 32 : 64} onChange={(event) => editor.setName(event.target.value)} /></label>
    {target?.kind === 'project' ? <><label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">{t('项目代号')}<Input disabled={editor.pending} value={editor.code} maxLength={24} onChange={(event) => editor.setCode(event.target.value)} /></label><label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">{t('项目描述')}<Textarea disabled={editor.pending} value={editor.description} maxLength={500} rows={4} onChange={(event) => editor.setDescription(event.target.value)} /></label></> : <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">{t('颜色')}<LabeledSelect disabled={editor.pending} value={editor.color} options={getAssetColorOptions()} onValueChange={(value) => editor.setColor(value as AssetColorToken)} /></label>}
    <DialogFooter><Button type="button" variant="outline" disabled={editor.pending} onClick={() => editor.handleOpenChange(false)}>{t('取消')}</Button><Button type="button" disabled={editor.pending || !editor.name.trim()} onClick={() => { void editor.submit() }}>{editor.pending ? t('保存中…') : t('保存')}</Button></DialogFooter>
  </DialogContent></Dialog>
}
export function SessionAssetCatalogDeleteDialog(props: CatalogDeleteProps) {
  const dialog = useCatalogDeleteDialog(props)
  const impactFailed = Boolean(dialog.error && !dialog.impact)
  const description = impactFailed ? t('关联会话分析失败，请重试。') : dialog.impact ? t('当前关联 ${} 个会话。', dialog.impact.session_count) : t('正在分析关联会话。')
  return <AlertDialog open={Boolean(props.target)} onOpenChange={dialog.handleOpenChange}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('删除“')}{props.target?.item.name}”？</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription></AlertDialogHeader>
    {dialog.error && <Alert variant="destructive"><AlertDescription>{dialog.error}{impactFailed ? <Button size="xs" variant="outline" className="ml-2" disabled={dialog.impactPending || dialog.pending} onClick={dialog.retryImpact}>{t('重试')}</Button> : null}</AlertDescription></Alert>}
    {dialog.isTag ? <div className="flex items-center gap-2 text-sm"><Badge variant="outline" data-asset-color={(props.target?.item as AssetTag | undefined)?.colorToken} className="asset-color-badge">{props.target?.item.name}</Badge><span>{t('确认后将从所有关联会话移除此标签。')}</span></div> : <div className="flex flex-col gap-3"><LabeledSelect disabled={dialog.pending || dialog.impactPending} ariaLabel={t('删除关联处理方式')} value={dialog.mode} options={dialog.alternatives.length > 0 ? [{ value: 'migrate', label: t('迁移到其他项') }, { value: 'clear', label: t('清空关联') }] : [{ value: 'clear', label: t('清空关联（无可迁移项）') }]} onValueChange={(value) => dialog.setMode(value as 'migrate' | 'clear')} />{dialog.mode === 'migrate' && <LabeledSelect disabled={dialog.pending || dialog.impactPending} ariaLabel={t('迁移目标')} value={dialog.replacementID} placeholder={t('选择迁移目标')} options={dialog.alternatives.map((item) => ({ value: item.id, label: item.name }))} onValueChange={dialog.setReplacementID} />}</div>}
    <AlertDialogFooter><AlertDialogCancel disabled={dialog.pending}>{t('取消')}</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={dialog.pending || !dialog.canSubmit} onClick={() => { void dialog.submit() }}>{dialog.pending ? t('删除中…') : dialog.impact ? t('确认处理 ${} 个会话并删除', dialog.impact.session_count) : t('确认删除')}</AlertDialogAction></AlertDialogFooter>
  </AlertDialogContent></AlertDialog>
}
