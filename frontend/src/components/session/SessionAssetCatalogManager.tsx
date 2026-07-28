import { ArrowDown, ArrowUp, MoreHorizontal, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { AssetColorToken, AssetEnvironment, AssetProject, AssetTag } from '@/hooks/useSession'
import { SessionAssetCatalogDeleteDialog, SessionAssetCatalogEditor, type CatalogDeleteTarget, type CatalogEditorTarget, type CatalogKind } from '@/components/session/SessionAssetCatalogDialogs'
import { t } from '@/i18n'
import { OperationBusyError } from '@/lib/operationBusyError'


interface Props {
  environments: AssetEnvironment[]
  projects: AssetProject[]
  tags: AssetTag[]
  onCreateEnvironment: (name: string, color: AssetColorToken) => Promise<AssetEnvironment>
  onCreateProject: (name: string, code: string, description?: string) => Promise<AssetProject>
  onCreateTag: (name: string, color: AssetColorToken) => Promise<AssetTag>
  onUpdateEnvironment: (item: AssetEnvironment) => Promise<void>
  onUpdateProject: (item: AssetProject) => Promise<void>
  onUpdateTag: (item: AssetTag) => Promise<void>
  onDeleteEnvironment: (id: string, mode: 'migrate' | 'clear', replacementID: string | null) => Promise<void>
  onDeleteProject: (id: string, mode: 'migrate' | 'clear', replacementID: string | null) => Promise<void>
  onDeleteTag: (id: string) => Promise<void>
  onReorderEnvironments: (ids: string[]) => Promise<void>
  onReorderProjects: (ids: string[]) => Promise<void>
}

export function SessionAssetCatalogManager(props: Props) {
  const [tab, setTab] = useState<CatalogKind>('environment')
  const [editor, setEditor] = useState<CatalogEditorTarget | null>(null)
  const [deleting, setDeleting] = useState<CatalogDeleteTarget | null>(null)
  const mutation = useCatalogMutationLease()
  const actions = catalogMutationActions(props, mutation.run)
  const openEditor = (target: CatalogEditorTarget) => { if (mutation.available()) setEditor(target) }
  const openDelete = (target: CatalogDeleteTarget) => { if (mutation.available()) setDeleting(target) }
  return <div className="flex min-h-0 flex-1 flex-col gap-3" aria-busy={mutation.busy}>
    <div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-semibold text-foreground">{t('分类管理')}</h2><p className="text-xs text-muted-foreground">{t('统一维护环境、项目与标签目录。')}</p></div><Button type="button" disabled={mutation.busy} onClick={() => openEditor({ kind: tab })}><Plus data-icon="inline-start" />{t('新建')}{kindLabel(tab)}</Button></div>
    <Tabs value={tab} onValueChange={(value) => { if (mutation.available()) setTab(value as CatalogKind) }} className="min-h-0 flex-1"><TabsList variant="line"><TabsTrigger value="environment" disabled={mutation.busy}>{t('环境')} <Badge variant="secondary">{props.environments.length}</Badge></TabsTrigger><TabsTrigger value="project" disabled={mutation.busy}>{t('项目')} <Badge variant="secondary">{props.projects.length}</Badge></TabsTrigger><TabsTrigger value="tag" disabled={mutation.busy}>{t('标签')} <Badge variant="secondary">{props.tags.length}</Badge></TabsTrigger></TabsList>
      <TabsContent value="environment" className="pt-3"><CatalogTable disabled={mutation.busy} kind="environment" items={props.environments} onEdit={(item) => openEditor({ kind: 'environment', item })} onDelete={(item) => openDelete({ kind: 'environment', item })} onMove={(index, direction) => actions.onReorderEnvironments(reorderedIDs(props.environments, index, direction))} /></TabsContent>
      <TabsContent value="project" className="pt-3"><CatalogTable disabled={mutation.busy} kind="project" items={props.projects} onEdit={(item) => openEditor({ kind: 'project', item })} onDelete={(item) => openDelete({ kind: 'project', item })} onMove={(index, direction) => actions.onReorderProjects(reorderedIDs(props.projects, index, direction))} /></TabsContent>
      <TabsContent value="tag" className="pt-3"><CatalogTable disabled={mutation.busy} kind="tag" items={props.tags} onEdit={(item) => openEditor({ kind: 'tag', item })} onDelete={(item) => openDelete({ kind: 'tag', item })} /></TabsContent>
    </Tabs>
    <SessionAssetCatalogEditor target={editor} onOpenChange={(open) => { if (!open) setEditor(null) }} {...actions} />
    <SessionAssetCatalogDeleteDialog target={deleting} environments={props.environments} projects={props.projects} onOpenChange={(open) => { if (!open) setDeleting(null) }} onDeleteEnvironment={actions.onDeleteEnvironment} onDeleteProject={actions.onDeleteProject} onDeleteTag={actions.onDeleteTag} />
  </div>
}

function CatalogTable({ disabled, kind, items, onEdit, onDelete, onMove }: { disabled: boolean; kind: CatalogKind; items: (AssetEnvironment | AssetProject | AssetTag)[]; onEdit: (item: AssetEnvironment | AssetProject | AssetTag) => void; onDelete: (item: AssetEnvironment | AssetProject | AssetTag) => void; onMove?: (index: number, direction: -1 | 1) => Promise<void> }) {
  const [reorderError, setReorderError] = useState('')
  const [reordering, setReordering] = useState(false)
  const lifecycle = useRef(0)
  const generation = useRef(0)
  const requestID = useRef(0)
  const reorderActive = useRef(false)
  const targetKey = items.map((item) => item.id).join('|')
  useEffect(() => {
    const token = ++lifecycle.current
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [])
  useEffect(() => {
    generation.current++
    setReordering(reorderActive.current)
    setReorderError('')
  }, [kind, targetKey])
  const move = async (index: number, direction: -1 | 1) => {
    if (disabled || !onMove || reorderActive.current) return
    reorderActive.current = true
    const lifecycleToken = lifecycle.current
    const generationToken = generation.current
    const request = ++requestID.current
    const isCurrent = () => lifecycle.current === lifecycleToken && generation.current === generationToken
      && requestID.current === request
    setReordering(true)
    setReorderError('')
    try {
      await onMove(index, direction)
    } catch (reason) {
      if (isCurrent()) setReorderError(t('调整资产排序失败: ${}', reason instanceof Error ? reason.message : String(reason)))
    } finally {
      if (requestID.current === request) {
        reorderActive.current = false
        if (lifecycle.current === lifecycleToken) setReordering(false)
      }
    }
  }
  if (items.length === 0) return <Empty className="min-h-64 border"><EmptyHeader><EmptyTitle>{t('暂无')}{kindLabel(kind)}</EmptyTitle><EmptyDescription>{t('使用右上角按钮创建第一个')}{kindLabel(kind)}。</EmptyDescription></EmptyHeader></Empty>
  return <div className="flex flex-col gap-2">
  {reorderError ? <p role="alert" className="text-sm text-destructive">{reorderError}</p> : null}
  <div className="overflow-auto rounded-xl border border-border shadow-sm"><Table><TableHeader><TableRow><TableHead>{t('名称')}</TableHead>{kind === 'environment' && <TableHead>{t('颜色')}</TableHead>}{kind === 'project' && <><TableHead>{t('代号')}</TableHead><TableHead>{t('描述')}</TableHead></>}<TableHead>{t('关联会话')}</TableHead>{onMove && <TableHead>{t('排序')}</TableHead>}<TableHead className="w-20 text-right">{t('操作')}</TableHead></TableRow></TableHeader>
    <TableBody>{items.map((item, index) => <TableRow key={item.id}><TableCell className="font-medium">{item.name}</TableCell>{kind === 'environment' && <TableCell><Badge variant="outline" data-asset-color={(item as AssetEnvironment).colorToken} className="asset-color-badge">{(item as AssetEnvironment).colorToken}</Badge></TableCell>}{kind === 'project' && <><TableCell>{(item as AssetProject).code || '—'}</TableCell><TableCell className="max-w-64 truncate">{(item as AssetProject).description || '—'}</TableCell></>}<TableCell>{item.sessionCount}</TableCell>{onMove && <TableCell><div className="flex gap-1"><Button type="button" size="icon-xs" variant="ghost" aria-label={t('上移 ${}', item.name)} disabled={disabled || reordering || index === 0} onClick={() => { void move(index, -1) }}><ArrowUp /></Button><Button type="button" size="icon-xs" variant="ghost" aria-label={t('下移 ${}', item.name)} disabled={disabled || reordering || index === items.length - 1} onClick={() => { void move(index, 1) }}><ArrowDown /></Button></div></TableCell>}<TableCell><DropdownMenu><DropdownMenuTrigger render={<Button type="button" size="icon-xs" variant="ghost" aria-label={t('${} 分类操作', item.name)} disabled={disabled} />}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuItem onClick={() => onEdit(item)}>{t('编辑')}</DropdownMenuItem><DropdownMenuItem variant="destructive" onClick={() => onDelete(item)}>{t('删除')}</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu></TableCell></TableRow>)}</TableBody>
  </Table></div></div>
}

function reorderedIDs(items: { id: string }[], index: number, direction: -1 | 1) {
  const next = items.map((item) => item.id)
  const target = index + direction
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

function useCatalogMutationLease() {
  const active = useRef(false)
  const [busy, setBusy] = useState(false)
  const run = async <T,>(operation: () => Promise<T>) => {
    if (active.current) throw new OperationBusyError(t('资产分类操作正在进行'))
    active.current = true
    setBusy(true)
    try {
      return await operation()
    } finally {
      active.current = false
      setBusy(false)
    }
  }
  return { busy, available: () => !active.current, run }
}

function catalogMutationActions(props: Props, run: ReturnType<typeof useCatalogMutationLease>['run']) {
  return {
    onCreateEnvironment: (name: string, color: AssetColorToken) => run(() => props.onCreateEnvironment(name, color)),
    onCreateProject: (name: string, code: string, description?: string) => run(() => props.onCreateProject(name, code, description)),
    onCreateTag: (name: string, color: AssetColorToken) => run(() => props.onCreateTag(name, color)),
    onUpdateEnvironment: (item: AssetEnvironment) => run(() => props.onUpdateEnvironment(item)),
    onUpdateProject: (item: AssetProject) => run(() => props.onUpdateProject(item)),
    onUpdateTag: (item: AssetTag) => run(() => props.onUpdateTag(item)),
    onDeleteEnvironment: (id: string, mode: 'migrate' | 'clear', replacementID: string | null) => run(() => props.onDeleteEnvironment(id, mode, replacementID)),
    onDeleteProject: (id: string, mode: 'migrate' | 'clear', replacementID: string | null) => run(() => props.onDeleteProject(id, mode, replacementID)),
    onDeleteTag: (id: string) => run(() => props.onDeleteTag(id)),
    onReorderEnvironments: (ids: string[]) => run(() => props.onReorderEnvironments(ids)),
    onReorderProjects: (ids: string[]) => run(() => props.onReorderProjects(ids)),
  }
}

function kindLabel(kind: CatalogKind) { return kind === 'environment' ? t('环境') : kind === 'project' ? t('项目') : t('标签') }
