import { ArrowDown, ArrowUp, MoreHorizontal, Plus } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/components/ui/toast'
import type { AssetColorToken, AssetEnvironment, AssetProject, AssetTag } from '@/hooks/useSession'
import { SessionAssetCatalogDeleteDialog, SessionAssetCatalogEditor, type CatalogDeleteTarget, type CatalogEditorTarget, type CatalogKind } from '@/components/session/SessionAssetCatalogDialogs'
import { t } from '@/i18n'


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
  return <div className="flex min-h-0 flex-1 flex-col gap-3">
    <div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-semibold text-foreground">{t('分类管理')}</h2><p className="text-xs text-muted-foreground">{t('统一维护环境、项目与标签目录。')}</p></div><Button type="button" onClick={() => setEditor({ kind: tab })}><Plus data-icon="inline-start" />{t('新建')}{kindLabel(tab)}</Button></div>
    <Tabs value={tab} onValueChange={(value) => setTab(value as CatalogKind)} className="min-h-0 flex-1"><TabsList variant="line"><TabsTrigger value="environment">{t('环境')} <Badge variant="secondary">{props.environments.length}</Badge></TabsTrigger><TabsTrigger value="project">{t('项目')} <Badge variant="secondary">{props.projects.length}</Badge></TabsTrigger><TabsTrigger value="tag">{t('标签')} <Badge variant="secondary">{props.tags.length}</Badge></TabsTrigger></TabsList>
      <TabsContent value="environment" className="pt-3"><CatalogTable kind="environment" items={props.environments} onEdit={(item) => setEditor({ kind: 'environment', item })} onDelete={(item) => setDeleting({ kind: 'environment', item })} onMove={(index, direction) => props.onReorderEnvironments(reorderedIDs(props.environments, index, direction))} /></TabsContent>
      <TabsContent value="project" className="pt-3"><CatalogTable kind="project" items={props.projects} onEdit={(item) => setEditor({ kind: 'project', item })} onDelete={(item) => setDeleting({ kind: 'project', item })} onMove={(index, direction) => props.onReorderProjects(reorderedIDs(props.projects, index, direction))} /></TabsContent>
      <TabsContent value="tag" className="pt-3"><CatalogTable kind="tag" items={props.tags} onEdit={(item) => setEditor({ kind: 'tag', item })} onDelete={(item) => setDeleting({ kind: 'tag', item })} /></TabsContent>
    </Tabs>
    <SessionAssetCatalogEditor target={editor} onOpenChange={(open) => { if (!open) setEditor(null) }} {...props} />
    <SessionAssetCatalogDeleteDialog target={deleting} environments={props.environments} projects={props.projects} onOpenChange={(open) => { if (!open) setDeleting(null) }} onDeleteEnvironment={props.onDeleteEnvironment} onDeleteProject={props.onDeleteProject} onDeleteTag={props.onDeleteTag} />
  </div>
}

function CatalogTable({ kind, items, onEdit, onDelete, onMove }: { kind: CatalogKind; items: (AssetEnvironment | AssetProject | AssetTag)[]; onEdit: (item: AssetEnvironment | AssetProject | AssetTag) => void; onDelete: (item: AssetEnvironment | AssetProject | AssetTag) => void; onMove?: (index: number, direction: -1 | 1) => Promise<void> }) {
  if (items.length === 0) return <Empty className="min-h-64 border"><EmptyHeader><EmptyTitle>{t('暂无')}{kindLabel(kind)}</EmptyTitle><EmptyDescription>{t('使用右上角按钮创建第一个')}{kindLabel(kind)}。</EmptyDescription></EmptyHeader></Empty>
  const move = async (index: number, direction: -1 | 1) => {
    if (!onMove) return
    try { await onMove(index, direction) } catch (error) { toast(error instanceof Error ? error.message : String(error), 'error') }
  }
  return <div className="overflow-auto rounded-xl border border-border shadow-sm"><Table><TableHeader><TableRow><TableHead>{t('名称')}</TableHead>{kind === 'environment' && <TableHead>{t('颜色')}</TableHead>}{kind === 'project' && <><TableHead>{t('代号')}</TableHead><TableHead>{t('描述')}</TableHead></>}<TableHead>{t('关联会话')}</TableHead>{onMove && <TableHead>{t('排序')}</TableHead>}<TableHead className="w-20 text-right">{t('操作')}</TableHead></TableRow></TableHeader>
    <TableBody>{items.map((item, index) => <TableRow key={item.id}><TableCell className="font-medium">{item.name}</TableCell>{kind === 'environment' && <TableCell><Badge variant="outline" data-asset-color={(item as AssetEnvironment).colorToken} className="asset-color-badge">{(item as AssetEnvironment).colorToken}</Badge></TableCell>}{kind === 'project' && <><TableCell>{(item as AssetProject).code || '—'}</TableCell><TableCell className="max-w-64 truncate">{(item as AssetProject).description || '—'}</TableCell></>}<TableCell>{item.sessionCount}</TableCell>{onMove && <TableCell><div className="flex gap-1"><Button type="button" size="icon-xs" variant="ghost" aria-label={t('上移 ${}', item.name)} disabled={index === 0} onClick={() => { void move(index, -1) }}><ArrowUp /></Button><Button type="button" size="icon-xs" variant="ghost" aria-label={t('下移 ${}', item.name)} disabled={index === items.length - 1} onClick={() => { void move(index, 1) }}><ArrowDown /></Button></div></TableCell>}<TableCell><DropdownMenu><DropdownMenuTrigger render={<Button type="button" size="icon-xs" variant="ghost" aria-label={t('${} 分类操作', item.name)} />}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuItem onClick={() => onEdit(item)}>{t('编辑')}</DropdownMenuItem><DropdownMenuItem variant="destructive" onClick={() => onDelete(item)}>{t('删除')}</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu></TableCell></TableRow>)}</TableBody>
  </Table></div>
}

function reorderedIDs(items: { id: string }[], index: number, direction: -1 | 1) {
  const next = items.map((item) => item.id)
  const target = index + direction
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

function kindLabel(kind: CatalogKind) { return kind === 'environment' ? t('环境') : kind === 'project' ? t('项目') : t('标签') }
