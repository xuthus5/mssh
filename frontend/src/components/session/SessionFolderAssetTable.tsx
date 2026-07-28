import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SessionService } from '@/lib/wails'
import type { Folder, Session } from '@/hooks/useSession'
import { t } from '@/i18n'


export type DeleteTarget = { type: 'folder' | 'session'; item: Folder | Session }

export function SessionFolderAssetTable({ folders, sessions, onOpen, onRename, onSetDefault, onDelete }: { folders: Folder[]; sessions: Session[]; onOpen: (id: string) => void; onRename: (folder: Folder) => void; onSetDefault: (id: string) => void; onDelete: (folder: Folder) => void }) {
  return <div className="rounded-xl border border-border shadow-sm"><Table><TableHeader><TableRow><TableHead>{t('分组名称')}</TableHead><TableHead>{t('节点数')}</TableHead><TableHead>{t('状态')}</TableHead><TableHead className="text-right">{t('操作')}</TableHead></TableRow></TableHeader><TableBody>{folders.map((folder) => <TableRow key={folder.id}><TableCell><button type="button" className="font-medium text-foreground hover:underline" onClick={() => onOpen(folder.id)}>{folder.name}</button></TableCell><TableCell>{sessions.filter((session) => session.folderId === folder.id).length}</TableCell><TableCell>{folder.isDefault ? <Badge>{t('默认')}</Badge> : <Badge variant="outline">{t('普通')}</Badge>}</TableCell><TableCell><div className="flex justify-end gap-1"><Button size="xs" variant="outline" onClick={() => onRename(folder)}>{t('重命名')}</Button><Button size="xs" variant="outline" disabled={folder.isDefault} onClick={() => onSetDefault(folder.id)}>{t('设为默认')}</Button><Button size="xs" variant="destructive" disabled={folder.isDefault || folders.length <= 1} onClick={() => onDelete(folder)}>{t('删除')}</Button></div></TableCell></TableRow>)}</TableBody></Table></div>
}

export function SessionNodeBreadcrumb({ folder, onClear }: { folder?: Folder; onClear: () => void }) {
  return <Breadcrumb><BreadcrumbList><BreadcrumbItem>{folder ? <BreadcrumbLink render={<button type="button" onClick={onClear} />}>{t('所有节点')}</BreadcrumbLink> : <BreadcrumbPage>{t('所有节点')}</BreadcrumbPage>}</BreadcrumbItem>{folder && <><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>{folder.name}</BreadcrumbPage></BreadcrumbItem></>}</BreadcrumbList></Breadcrumb>
}

function useDeleteImpact({ target, lifecycle, targetGeneration }: {
  target: DeleteTarget | null
  lifecycle: MutableRefObject<number>
  targetGeneration: MutableRefObject<number>
}) {
  const [impact, setImpact] = useState<{ tunnels: number; history: number; recordings: number; transfers: number } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const generation = ++targetGeneration.current
    setImpact(null)
    setError('')
    if (target?.type !== 'session') return
    const lifecycleToken = lifecycle.current
    let current = true
    void SessionService.SessionDeleteImpact(Number(target.item.id)).then((value) => {
      if (current && lifecycle.current === lifecycleToken && targetGeneration.current === generation) setImpact(value)
    }).catch((reason) => {
      if (!current || lifecycle.current !== lifecycleToken || targetGeneration.current !== generation) return
      setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { current = false }
  }, [lifecycle, target, targetGeneration])
  return { impact, error, setError }
}

export function SessionAssetDeleteDialog({ target, folders, sessions, onOpenChange, onConfirm }: { target: DeleteTarget | null; folders: Folder[]; sessions: Session[]; onOpenChange: (open: boolean) => void; onConfirm: (target: DeleteTarget) => Promise<void> }) {
  const [pending, setPending] = useState(false)
  const lifecycle = useRef(0)
  const targetGeneration = useRef(0)
  const deleteRequest = useRef(0)
  const deleteActive = useRef(false)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [])
  const { impact, error, setError } = useDeleteImpact({ target, lifecycle, targetGeneration })
  const confirm = async () => {
    if (!target || deleteActive.current) return
    deleteActive.current = true
    const lifecycleToken = lifecycle.current
    const generation = targetGeneration.current
    const request = ++deleteRequest.current
    const isLatest = () => lifecycle.current === lifecycleToken && deleteRequest.current === request
    const isCurrent = () => isLatest() && targetGeneration.current === generation
    const deleteTarget = target
    setPending(true); setError('')
    try { await onConfirm(deleteTarget) } catch (reason) {
      // dialog owns delete failures via inline alert; workspace no longer toasts
      const message = reason instanceof Error ? reason.message : String(reason)
      if (isCurrent()) setError(deleteTarget.type === 'folder' ? t('删除分组失败: ${}', message) : t('删除会话失败: ${}', message))
    }
    finally {
      if (deleteRequest.current === request) deleteActive.current = false
      if (isLatest()) setPending(false)
    }
  }
  const handleOpenChange = (open: boolean) => {
    if (!open && deleteActive.current) return
    if (!open) {
      targetGeneration.current++
      deleteRequest.current++
      setPending(false)
      setError('')
    }
    onOpenChange(open)
  }
  const folder = target?.type === 'folder' ? target.item as Folder : undefined
  const description = folder ? t('其中 ${} 个会话和 ${} 个子分组将迁移到默认分组。', sessions.filter((session) => session.folderId === folder.id).length, folders.filter((item) => item.parentId === folder.id).length) : error ? t('分析关联资产影响失败，影响范围未知。仍可继续删除。') : impact ? t('将同时影响 ${} 条隧道、${} 条命令历史、${} 条录制记录和 ${} 个进行中传输。', impact.tunnels, impact.history, impact.recordings, impact.transfers) : t('正在分析关联资产影响范围。')
  return <AlertDialog open={Boolean(target)} onOpenChange={handleOpenChange}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('删除“')}{target?.item.name}”？</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription></AlertDialogHeader>{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}<AlertDialogFooter><AlertDialogCancel disabled={pending}>{t('取消')}</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={pending} onClick={() => { void confirm() }}>{pending ? t('删除中…') : t('确认删除')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
}
