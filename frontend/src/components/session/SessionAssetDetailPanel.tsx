import { CopyPlus, Pencil, Plug, Trash2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import type { Folder, Session } from '@/hooks/useSession'

export function SessionAssetDetailPanel({ session, folders, activeTerminalCount, onClose, onConnect, onEdit, onDelete, onDuplicateTerminal }: { session: Session | null; folders: Folder[]; activeTerminalCount: number; onClose: () => void; onConnect: (id: string) => void; onEdit: (session: Session) => void; onDelete: (session: Session) => void; onDuplicateTerminal: (session: Session) => void }) {
  if (!session) return null
  return <aside aria-label="会话资产详情" className="absolute inset-y-0 right-0 z-20 flex w-[26rem] flex-col border-l border-border bg-popover shadow-xl">
    <header className="flex items-start justify-between gap-3 border-b border-border p-4"><div className="min-w-0"><h2 className="truncate text-base font-semibold text-foreground">{session.name}</h2><p className="truncate text-xs text-muted-foreground">{session.username}@{session.host}:{session.port}</p></div><Button type="button" size="icon-sm" variant="ghost" aria-label="关闭会话详情" onClick={onClose}><X /></Button></header>
    <div className="min-h-0 flex-1 overflow-y-auto p-4"><DetailSection title="基本信息"><Detail label="分组" value={folders.find((folder) => folder.id === session.folderId)?.name ?? '未分组'} /><Detail label="认证方式" value={session.authMethod} /><Detail label="终端类型" value={session.termType} /></DetailSection><Separator className="my-4" /><DetailSection title="资产信息"><Detail label="环境" value={session.environment?.name ?? '未设置'} /><Detail label="项目" value={session.project ? `${session.project.code ? `${session.project.code} · ` : ''}${session.project.name}` : '未关联'} /><div><p className="text-xs text-muted-foreground">标签</p><div className="mt-1 flex flex-wrap gap-1">{(session.tags ?? []).map((tag) => <Badge key={tag.id} variant="outline" data-asset-color={tag.colorToken} className="asset-color-badge">{tag.name}</Badge>)}{(session.tags?.length ?? 0) === 0 && <span className="text-sm text-foreground">无</span>}</div></div></DetailSection><Separator className="my-4" /><DetailSection title="备注"><p className="whitespace-pre-wrap text-sm text-foreground">{session.notes || '暂无备注'}</p></DetailSection><Separator className="my-4" /><DetailSection title="使用统计"><Detail label="最近连接" value={session.lastConnectedAt ? new Date(session.lastConnectedAt).toLocaleString() : '从未连接'} /><Detail label="连接次数" value={`${session.connectionCount ?? 0} 次`} /><Detail label="活动终端" value={`${activeTerminalCount} 个`} /></DetailSection></div>
    <footer className="grid grid-cols-2 gap-2 border-t border-border p-4"><Button onClick={() => onConnect(session.id)}><Plug data-icon="inline-start" />连接</Button><Button variant="outline" onClick={() => onEdit(session)}><Pencil data-icon="inline-start" />编辑</Button><Button variant="outline" disabled={activeTerminalCount === 0} onClick={() => onDuplicateTerminal(session)}><CopyPlus data-icon="inline-start" />复制终端</Button><Button variant="destructive" onClick={() => onDelete(session)}><Trash2 data-icon="inline-start" />删除</Button></footer>
  </aside>
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="flex flex-col gap-3"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>{children}</section>
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2"><span className="text-xs text-muted-foreground">{label}</span><span className="truncate text-sm text-foreground">{value}</span></div>
}
