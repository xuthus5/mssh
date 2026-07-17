import { MoreHorizontal, Server } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { Folder, Session } from '@/hooks/useSession'

interface Props {
  sessions: Session[]
  folders: Folder[]
  selectedIDs: Set<string>
  recent?: boolean
  onSelectionChange: (ids: Set<string>) => void
  onConnect: (id: string) => void
  onOpenDetail: (session: Session) => void
  onEdit: (session: Session) => void
  onDelete: (session: Session) => void
  onMove: (id: string, folderID: string | null) => void
}

export function SessionAssetTable(props: Props) {
  if (props.sessions.length === 0) return <Empty className="min-h-64 border"><EmptyHeader><EmptyMedia variant="icon"><Server /></EmptyMedia><EmptyTitle>{props.recent ? '暂无最近连接' : '暂无会话节点'}</EmptyTitle><EmptyDescription>{props.recent ? '成功连接会话后会显示在这里。' : '调整筛选条件或创建第一个会话。'}</EmptyDescription></EmptyHeader></Empty>
  const allSelected = props.sessions.every((session) => props.selectedIDs.has(session.id))
  const toggleAll = () => { const next = new Set(props.selectedIDs); props.sessions.forEach((session) => allSelected ? next.delete(session.id) : next.add(session.id)); props.onSelectionChange(next) }
  return <div className="overflow-auto rounded-xl border border-border shadow-sm"><Table><TableHeader><TableRow><TableHead className="w-10"><Checkbox aria-label="选择当前列表全部会话" checked={allSelected} onCheckedChange={toggleAll} /></TableHead><TableHead>名称</TableHead><TableHead>端点</TableHead><TableHead>环境</TableHead><TableHead>项目</TableHead><TableHead>标签</TableHead><TableHead>分组</TableHead>{props.recent && <TableHead>最近连接</TableHead>}<TableHead className="w-24 text-right">操作</TableHead></TableRow></TableHeader><TableBody>{props.sessions.map((session) => <AssetRow key={session.id} session={session} {...props} />)}</TableBody></Table></div>
}

function AssetRow({ session, folders, selectedIDs, recent, onSelectionChange, onConnect, onOpenDetail, onEdit, onDelete, onMove }: Props & { session: Session }) {
  const selected = selectedIDs.has(session.id)
  const toggle = () => { const next = new Set(selectedIDs); if (selected) next.delete(session.id); else next.add(session.id); onSelectionChange(next) }
  const tags = session.tags ?? []
  return <TableRow data-state={selected ? 'selected' : undefined} className="cursor-pointer" tabIndex={0} onClick={() => onOpenDetail(session)} onDoubleClick={() => onConnect(session.id)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.ctrlKey) onOpenDetail(session); if (event.key === 'Enter' && event.ctrlKey) onConnect(session.id) }}>
    <TableCell onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}><Checkbox aria-label={`选择 ${session.name}`} checked={selected} onCheckedChange={toggle} /></TableCell>
    <TableCell className="font-medium">{session.name}</TableCell><TableCell>{session.username}@{session.host}:{session.port}</TableCell>
    <TableCell>{session.environment ? <Badge variant="outline" data-asset-color={session.environment.colorToken} className="asset-color-badge">{session.environment.name}</Badge> : <span className="text-xs text-muted-foreground">未设置</span>}</TableCell>
    <TableCell>{session.project ? <Badge variant="secondary">{session.project.code || session.project.name}</Badge> : <span className="text-xs text-muted-foreground">未关联</span>}</TableCell>
    <TableCell><div className="flex max-w-48 items-center gap-1">{tags.slice(0, 2).map((tag) => <Badge key={tag.id} variant="outline" data-asset-color={tag.colorToken} className="asset-color-badge max-w-20 truncate">{tag.name}</Badge>)}{tags.length > 2 && <span className="text-xs text-muted-foreground">+{tags.length - 2}</span>}{tags.length === 0 && <span className="text-xs text-muted-foreground">无</span>}</div></TableCell>
    <TableCell>{folders.find((folder) => folder.id === session.folderId)?.name ?? '未分组'}</TableCell>{recent && <TableCell>{formatRecent(session)}</TableCell>}
    <TableCell onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}><div className="flex justify-end gap-1"><Button size="xs" onClick={() => onConnect(session.id)}>连接</Button><DropdownMenu><DropdownMenuTrigger render={<Button size="icon-xs" variant="ghost" aria-label={`${session.name} 更多操作`} />}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuItem onClick={() => onEdit(session)}>编辑</DropdownMenuItem><DropdownMenuSub><DropdownMenuSubTrigger>移动到分组</DropdownMenuSubTrigger><DropdownMenuSubContent><DropdownMenuGroup>{folders.map((folder) => <DropdownMenuItem key={folder.id} disabled={folder.id === session.folderId} onClick={() => onMove(session.id, folder.id)}>{folder.name}</DropdownMenuItem>)}</DropdownMenuGroup></DropdownMenuSubContent></DropdownMenuSub><DropdownMenuItem variant="destructive" onClick={() => onDelete(session)}>删除</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu></div></TableCell>
  </TableRow>
}

function formatRecent(session: Session) {
  return `${session.lastConnectedAt ? new Date(session.lastConnectedAt).toLocaleString() : '-'} · ${session.connectionCount ?? 0} 次`
}
