import { useEffect, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { Textarea } from '@/components/ui/textarea'
import type { AssetColorToken, AssetEnvironment, AssetProject, AssetTag } from '@/hooks/useSession'
import { ASSET_COLOR_OPTIONS } from '@/lib/assetColors'
import { AssetCatalogService } from '@/lib/wails'

export type CatalogKind = 'environment' | 'project' | 'tag'
export type CatalogItem = AssetEnvironment | AssetProject | AssetTag
export interface CatalogEditorTarget { kind: CatalogKind; item?: CatalogItem }
export interface CatalogDeleteTarget { kind: CatalogKind; item: CatalogItem }

interface EditorProps {
  target: CatalogEditorTarget | null
  onOpenChange: (open: boolean) => void
  onCreateEnvironment: (name: string, color: AssetColorToken) => Promise<AssetEnvironment>
  onCreateProject: (name: string, code: string, description?: string) => Promise<AssetProject>
  onCreateTag: (name: string, color: AssetColorToken) => Promise<AssetTag>
  onUpdateEnvironment: (item: AssetEnvironment) => Promise<void>
  onUpdateProject: (item: AssetProject) => Promise<void>
  onUpdateTag: (item: AssetTag) => Promise<void>
}

export function SessionAssetCatalogEditor(props: EditorProps) {
  const { target } = props
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState<AssetColorToken>('slate')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    setName(target?.item?.name ?? '')
    setCode(target?.kind === 'project' && target.item ? (target.item as AssetProject).code : '')
    setDescription(target?.kind === 'project' && target.item ? (target.item as AssetProject).description : '')
    setColor(target?.kind !== 'project' && target?.item ? (target.item as AssetEnvironment | AssetTag).colorToken : 'slate')
    setError('')
  }, [target])
  const submit = async () => {
    if (!target) return
    setPending(true); setError('')
    try {
      await saveCatalog(props, target, { name: name.trim(), code: code.trim(), description: description.trim(), color })
      props.onOpenChange(false)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setPending(false) }
  }
  const noun = target?.kind === 'environment' ? '环境' : target?.kind === 'project' ? '项目' : '标签'
  return <Dialog open={Boolean(target)} onOpenChange={props.onOpenChange}><DialogContent><DialogHeader><DialogTitle>{target?.item ? '编辑' : '新建'}{noun}</DialogTitle><DialogDescription>名称会在会话列表、搜索和详情中即时生效。</DialogDescription></DialogHeader>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">名称<Input autoFocus value={name} maxLength={target?.kind === 'tag' ? 32 : 64} onChange={(event) => setName(event.target.value)} /></label>
    {target?.kind === 'project' ? <><label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">项目代号<Input value={code} maxLength={24} onChange={(event) => setCode(event.target.value)} /></label><label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">项目描述<Textarea value={description} maxLength={500} rows={4} onChange={(event) => setDescription(event.target.value)} /></label></> : <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">颜色<LabeledSelect value={color} options={ASSET_COLOR_OPTIONS} onValueChange={(value) => setColor(value as AssetColorToken)} /></label>}
    <DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={() => props.onOpenChange(false)}>取消</Button><Button type="button" disabled={pending || !name.trim()} onClick={() => { void submit() }}>{pending ? '保存中…' : '保存'}</Button></DialogFooter>
  </DialogContent></Dialog>
}

async function saveCatalog(props: EditorProps, target: CatalogEditorTarget, values: { name: string; code: string; description: string; color: AssetColorToken }) {
  if (!target.item) {
    if (target.kind === 'environment') await props.onCreateEnvironment(values.name, values.color)
    else if (target.kind === 'project') await props.onCreateProject(values.name, values.code, values.description)
    else await props.onCreateTag(values.name, values.color)
    return
  }
  if (target.kind === 'environment') await props.onUpdateEnvironment({ ...(target.item as AssetEnvironment), name: values.name, colorToken: values.color })
  else if (target.kind === 'project') await props.onUpdateProject({ ...(target.item as AssetProject), name: values.name, code: values.code, description: values.description })
  else await props.onUpdateTag({ ...(target.item as AssetTag), name: values.name, colorToken: values.color })
}

interface DeleteProps {
  target: CatalogDeleteTarget | null
  environments: AssetEnvironment[]
  projects: AssetProject[]
  onOpenChange: (open: boolean) => void
  onDeleteEnvironment: (id: string, mode: 'migrate' | 'clear', replacementID: string | null) => Promise<void>
  onDeleteProject: (id: string, mode: 'migrate' | 'clear', replacementID: string | null) => Promise<void>
  onDeleteTag: (id: string) => Promise<void>
}

export function SessionAssetCatalogDeleteDialog(props: DeleteProps) {
  const [impact, setImpact] = useState<{ name: string; session_count: number } | null>(null)
  const [mode, setMode] = useState<'migrate' | 'clear'>('migrate')
  const [replacementID, setReplacementID] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const alternatives = props.target?.kind === 'environment' ? props.environments.filter((item) => item.id !== props.target?.item.id)
    : props.target?.kind === 'project' ? props.projects.filter((item) => item.id !== props.target?.item.id) : []
  useEffect(() => {
    if (!props.target) return
    setImpact(null); setError(''); setReplacementID('')
    setMode(props.target.kind === 'tag' || alternatives.length === 0 ? 'clear' : 'migrate')
    const load = props.target.kind === 'environment' ? AssetCatalogService.EnvironmentDeleteImpact
      : props.target.kind === 'project' ? AssetCatalogService.ProjectDeleteImpact : AssetCatalogService.TagDeleteImpact
    void load(Number(props.target.item.id)).then((value) => setImpact(value ? { name: value.name, session_count: value.session_count } : null)).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
  }, [props.target])
  const submit = async () => {
    if (!props.target) return
    setPending(true); setError('')
    try {
      if (props.target.kind === 'environment') await props.onDeleteEnvironment(props.target.item.id, mode, replacementID || null)
      else if (props.target.kind === 'project') await props.onDeleteProject(props.target.item.id, mode, replacementID || null)
      else await props.onDeleteTag(props.target.item.id)
      props.onOpenChange(false)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setPending(false) }
  }
  const isTag = props.target?.kind === 'tag'
  const canSubmit = Boolean(impact) && (isTag || mode === 'clear' || Boolean(replacementID))
  return <AlertDialog open={Boolean(props.target)} onOpenChange={props.onOpenChange}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除“{props.target?.item.name}”？</AlertDialogTitle><AlertDialogDescription>{impact ? `当前关联 ${impact.session_count} 个会话。` : '正在分析关联会话。'}</AlertDialogDescription></AlertDialogHeader>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {isTag ? <div className="flex items-center gap-2 text-sm"><Badge variant="outline" data-asset-color={(props.target?.item as AssetTag | undefined)?.colorToken} className="asset-color-badge">{props.target?.item.name}</Badge><span>确认后将从所有关联会话移除此标签。</span></div> : <div className="flex flex-col gap-3"><LabeledSelect ariaLabel="删除关联处理方式" value={mode} options={alternatives.length > 0 ? [{ value: 'migrate', label: '迁移到其他项' }, { value: 'clear', label: '清空关联' }] : [{ value: 'clear', label: '清空关联（无可迁移项）' }]} onValueChange={(value) => setMode(value as 'migrate' | 'clear')} />{mode === 'migrate' && <LabeledSelect ariaLabel="迁移目标" value={replacementID} placeholder="选择迁移目标" options={alternatives.map((item) => ({ value: item.id, label: item.name }))} onValueChange={setReplacementID} />}</div>}
    <AlertDialogFooter><AlertDialogCancel disabled={pending}>取消</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={pending || !canSubmit} onClick={() => { void submit() }}>{pending ? '删除中…' : `确认处理 ${impact?.session_count ?? 0} 个会话并删除`}</AlertDialogAction></AlertDialogFooter>
  </AlertDialogContent></AlertDialog>
}
