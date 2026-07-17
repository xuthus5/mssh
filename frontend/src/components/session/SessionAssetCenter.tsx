import { useEffect, useMemo, useState } from 'react'
import { FolderPlus, MoreHorizontal, Plus, Server, SquareTerminal } from 'lucide-react'
import { useSessionWorkspace } from '@/hooks/SessionWorkspaceContext'
import type { Folder, Session } from '@/hooks/useSession'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/components/ui/toast'
import { SessionService } from '@/lib/wails'

type AssetTab = 'recent' | 'folders' | 'nodes'
type DeleteTarget = { type: 'folder' | 'session'; item: Folder | Session }

export function SessionAssetCenter() {
  const state = useSessionWorkspace()
  const [tab, setTab] = useState<AssetTab>('recent')
  const [folderID, setFolderID] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  useEffect(() => {
    const selectFolder = (event: Event) => {
      const id = (event as CustomEvent<string>).detail
      setFolderID(id); setTab('nodes')
    }
    window.addEventListener('mssh:select-folder', selectFolder)
    return () => window.removeEventListener('mssh:select-folder', selectFolder)
  }, [])
  const selectedFolder = state.folders.find((folder) => folder.id === folderID)
  const filteredSessions = useMemo(() => state.sessions.filter((session) => (!folderID || session.folderId === folderID) && matchesSession(session, query)), [folderID, query, state.sessions])
  const run = async (action: () => Promise<unknown>) => {
    try { await action() } catch (error) { toast(error instanceof Error ? error.message : String(error), 'error') }
  }
  const confirmDelete = async () => {
    if (!deleteTarget) return
    if (deleteTarget.type === 'folder') await run(() => state.deleteFolder(deleteTarget.item.id))
    else await run(() => state.deleteSession(deleteTarget.item.id))
    setDeleteTarget(null)
  }
  return <section className="flex min-h-0 flex-1 flex-col bg-background p-5">
    <header className="flex shrink-0 items-start justify-between gap-4">
      <div><h1 className="text-xl font-semibold text-foreground">会话资产</h1><p className="text-sm text-muted-foreground">集中管理连接、分组与节点</p></div>
      <CreateMenu />
    </header>
    {state.error && <Alert variant="destructive" className="mt-4"><AlertDescription>{state.error}<Button size="xs" variant="outline" className="ml-3" onClick={() => { void Promise.all([state.listFolders(), state.listSessions(), state.listRecentSessions()]) }}>重试</Button></AlertDescription></Alert>}
    <Tabs value={tab} onValueChange={(value) => setTab(value as AssetTab)} className="mt-4 min-h-0 flex-1">
      <TabsList variant="line"><TabsTrigger value="recent">最近连接 <Badge variant="secondary">{state.recentSessions.length}</Badge></TabsTrigger><TabsTrigger value="folders">分组 <Badge variant="secondary">{state.folders.length}</Badge></TabsTrigger><TabsTrigger value="nodes">所有节点 <Badge variant="secondary">{state.sessions.length}</Badge></TabsTrigger></TabsList>
      <TabsContent value="recent" className="min-h-0 overflow-auto pt-4">{state.loading ? <LoadingRows /> : <SessionTable sessions={state.recentSessions} folders={state.folders} onConnect={state.connect} onEdit={editSession} onDelete={(session) => setDeleteTarget({ type: 'session', item: session })} onMove={state.moveSession} recent />}</TabsContent>
      <TabsContent value="folders" className="min-h-0 overflow-auto pt-4"><FolderTable folders={state.folders} sessions={state.sessions} onOpen={(id) => { setFolderID(id); setTab('nodes') }} onRename={editFolder} onSetDefault={(id) => void run(() => state.setDefaultFolder(id))} onDelete={(folder) => setDeleteTarget({ type: 'folder', item: folder })} /></TabsContent>
      <TabsContent value="nodes" className="min-h-0 overflow-auto pt-4">
        <div className="mb-3 flex items-center justify-between gap-3"><NodeBreadcrumb folder={selectedFolder} onClear={() => setFolderID(null)} /><Input aria-label="搜索所有节点" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、主机或用户" className="max-w-xs" /></div>
        <SessionTable sessions={filteredSessions} folders={state.folders} onConnect={state.connect} onEdit={editSession} onDelete={(session) => setDeleteTarget({ type: 'session', item: session })} onMove={state.moveSession} />
      </TabsContent>
    </Tabs>
    <DeleteDialog target={deleteTarget} folders={state.folders} sessions={state.sessions} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }} onConfirm={() => { void confirmDelete() }} />
  </section>
}

function CreateMenu() {
  return <DropdownMenu><DropdownMenuTrigger render={<Button />}><Plus data-icon="inline-start" />创建</DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent('mssh:new-session'))}><SquareTerminal />新建会话</DropdownMenuItem><DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent('mssh:new-folder'))}><FolderPlus />新建分组目录</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
}

function SessionTable({ sessions, folders, onConnect, onEdit, onDelete, onMove, recent = false }: { sessions: Session[]; folders: Folder[]; onConnect: (id: string) => void; onEdit: (session: Session) => void; onDelete: (session: Session) => void; onMove: (id: string, folderID: string | null) => void; recent?: boolean }) {
  if (sessions.length === 0) return <Empty className="min-h-64 border"><EmptyHeader><EmptyMedia variant="icon"><Server /></EmptyMedia><EmptyTitle>{recent ? '暂无最近连接' : '暂无会话节点'}</EmptyTitle><EmptyDescription>{recent ? '成功连接会话后会显示在这里。' : '使用创建菜单添加第一个会话。'}</EmptyDescription></EmptyHeader></Empty>
  return <div className="rounded-lg border"><Table><TableHeader><TableRow><TableHead>名称</TableHead><TableHead>端点</TableHead><TableHead>分组</TableHead>{recent && <TableHead>最近连接</TableHead>}<TableHead className="w-24 text-right">操作</TableHead></TableRow></TableHeader><TableBody>{sessions.map((session) => <TableRow key={session.id}><TableCell className="font-medium">{session.name}</TableCell><TableCell>{session.username}@{session.host}:{session.port}</TableCell><TableCell>{folders.find((folder) => folder.id === session.folderId)?.name ?? '未分组'}</TableCell>{recent && <TableCell>{formatRecent(session)}</TableCell>}<TableCell><div className="flex justify-end gap-1"><Button size="xs" onClick={() => onConnect(session.id)}>连接</Button><DropdownMenu><DropdownMenuTrigger render={<Button size="icon-xs" variant="ghost" aria-label={`${session.name} 更多操作`} />}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuItem onClick={() => onEdit(session)}>编辑</DropdownMenuItem><DropdownMenuSub><DropdownMenuSubTrigger>移动到分组</DropdownMenuSubTrigger><DropdownMenuSubContent><DropdownMenuGroup>{folders.map((folder) => <DropdownMenuItem key={folder.id} disabled={folder.id === session.folderId} onClick={() => onMove(session.id, folder.id)}>{folder.name}</DropdownMenuItem>)}</DropdownMenuGroup></DropdownMenuSubContent></DropdownMenuSub><DropdownMenuItem variant="destructive" onClick={() => onDelete(session)}>删除</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu></div></TableCell></TableRow>)}</TableBody></Table></div>
}

function FolderTable({ folders, sessions, onOpen, onRename, onSetDefault, onDelete }: { folders: Folder[]; sessions: Session[]; onOpen: (id: string) => void; onRename: (folder: Folder) => void; onSetDefault: (id: string) => void; onDelete: (folder: Folder) => void }) {
  return <div className="rounded-lg border"><Table><TableHeader><TableRow><TableHead>分组名称</TableHead><TableHead>节点数</TableHead><TableHead>状态</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader><TableBody>{folders.map((folder) => <TableRow key={folder.id}><TableCell><button type="button" className="font-medium text-foreground hover:underline" onClick={() => onOpen(folder.id)}>{folder.name}</button></TableCell><TableCell>{sessions.filter((session) => session.folderId === folder.id).length}</TableCell><TableCell>{folder.isDefault ? <Badge>默认</Badge> : <Badge variant="outline">普通</Badge>}</TableCell><TableCell><div className="flex justify-end gap-1"><Button size="xs" variant="outline" onClick={() => onRename(folder)}>重命名</Button><Button size="xs" variant="outline" disabled={folder.isDefault} onClick={() => onSetDefault(folder.id)}>设为默认</Button><Button size="xs" variant="destructive" disabled={folder.isDefault || folders.length <= 1} onClick={() => onDelete(folder)}>删除</Button></div></TableCell></TableRow>)}</TableBody></Table></div>
}

function NodeBreadcrumb({ folder, onClear }: { folder?: Folder; onClear: () => void }) {
  return <Breadcrumb><BreadcrumbList><BreadcrumbItem>{folder ? <BreadcrumbLink render={<button type="button" onClick={onClear} />}>所有节点</BreadcrumbLink> : <BreadcrumbPage>所有节点</BreadcrumbPage>}</BreadcrumbItem>{folder && <><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>{folder.name}</BreadcrumbPage></BreadcrumbItem></>}</BreadcrumbList></Breadcrumb>
}

function DeleteDialog({ target, folders, sessions, onOpenChange, onConfirm }: { target: DeleteTarget | null; folders: Folder[]; sessions: Session[]; onOpenChange: (open: boolean) => void; onConfirm: () => void }) {
  const [impact, setImpact] = useState<{ tunnels: number; history: number; recordings: number } | null>(null)
  useEffect(() => {
    if (target?.type !== 'session') { setImpact(null); return }
    let current = true
    void SessionService.SessionDeleteImpact(Number(target.item.id)).then((value) => { if (current) setImpact(value) }).catch(() => { if (current) setImpact(null) })
    return () => { current = false }
  }, [target])
  const folder = target?.type === 'folder' ? target.item as Folder : undefined
  const description = folder ? `其中 ${sessions.filter((session) => session.folderId === folder.id).length} 个会话和 ${folders.filter((item) => item.parentId === folder.id).length} 个子分组将迁移到默认分组。` : impact ? `将同时影响 ${impact.tunnels} 条隧道、${impact.history} 条命令历史和 ${impact.recordings} 条录制记录。` : '正在分析关联资产影响范围。'
  return <AlertDialog open={Boolean(target)} onOpenChange={onOpenChange}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除“{target?.item.name}”？</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={onConfirm}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
}

function LoadingRows() { return <div className="flex flex-col gap-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div> }
function editSession(session: Session) { window.dispatchEvent(new CustomEvent('mssh:edit-session', { detail: session })) }
function editFolder(folder: Folder) { window.dispatchEvent(new CustomEvent('mssh:edit-folder', { detail: folder })) }
function matchesSession(session: Session, query: string) { const value = query.trim().toLowerCase(); return !value || [session.name, session.host, session.username].some((item) => item.toLowerCase().includes(value)) }
function formatRecent(session: Session) { return `${session.lastConnectedAt ? new Date(session.lastConnectedAt).toLocaleString() : '-'} · ${session.connectionCount ?? 0} 次` }
