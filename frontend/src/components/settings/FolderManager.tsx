import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Folder, Session } from '@/hooks/useSession'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'

interface Props {
  folders: Folder[]
  sessions: Session[]
  onCreate: (name: string, parentId: string | null) => Promise<Folder | undefined>
  onRename: (id: string, name: string) => Promise<void>
  onSetDefault: (id: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

export function FolderManager({ folders, sessions, onCreate, onRename, onSetDefault, onDelete }: Props) {
  const [selectedID, setSelectedID] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const selected = folders.find((folder) => folder.id === selectedID) ?? folders.find((folder) => folder.isDefault)

  useEffect(() => {
    if (!selectedID && selected) { setSelectedID(selected.id); setName(selected.name) }
  }, [selected, selectedID])

  const run = async (action: () => Promise<void>) => {
    setError('')
    try { await action() } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }

  return <div className="grid grid-cols-[180px_1fr] gap-4 pt-2 min-h-72">
    <div className="rounded-xl border bg-card p-2 space-y-1 overflow-auto">
      {folders.map((folder) => <button key={folder.id} type="button" onClick={() => { setSelectedID(folder.id); setName(folder.name) }} className={`w-full rounded-lg px-2 py-1.5 text-left text-sm ${selected?.id === folder.id ? 'bg-accent' : 'hover:bg-muted'}`}>
        {folder.name}{folder.isDefault && <Badge className="ml-2">默认</Badge>}
      </button>)}
    </div>
    <div className="space-y-3">
      {error && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{error}</div>}
      <div className="flex gap-2"><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="分组名称" /><Button onClick={() => void run(async () => { const created = await onCreate(name.trim(), null); if (created) { setSelectedID(created.id); setName(created.name) } })} disabled={!name.trim()}>新建</Button></div>
      {selected && <div className="rounded-xl border p-3 space-y-3 shadow-sm">
        <p className="text-sm text-muted-foreground">直属会话 {sessions.filter((session) => session.folderId === selected.id).length} 个，子分组 {folders.filter((folder) => folder.parentId === selected.id).length} 个</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void run(() => onRename(selected.id, name.trim()))} disabled={!name.trim()}>保存名称</Button>
          <Button variant="outline" onClick={() => void run(() => onSetDefault(selected.id))} disabled={selected.isDefault}>设为默认</Button>
          <Button variant="destructive" onClick={() => setConfirmDelete(true)} disabled={selected.isDefault || folders.length <= 1}>删除分组</Button>
        </div>
        {(selected.isDefault || folders.length <= 1) && <p className="text-xs text-muted-foreground">默认分组及系统最后一个分组不可删除。</p>}
      </div>}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除“{selected?.name}”？</AlertDialogTitle><AlertDialogDescription>其中 {sessions.filter((session) => session.folderId === selected?.id).length} 个会话和 {folders.filter((folder) => folder.parentId === selected?.id).length} 个子分组将迁移到默认分组。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { if (selected) void run(() => onDelete(selected.id)); setConfirmDelete(false) }}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  </div>
}
