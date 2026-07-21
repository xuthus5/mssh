import { useState } from 'react'
import { History, RotateCcw, Trash2 } from 'lucide-react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatSyncBytes, formatSyncDate } from '@/lib/cloudSyncForm'
import type { SyncVersion } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { t } from '@/i18n'


interface Props {
  versions: SyncVersion[]
  pending: string | null
  onRestore: (id: number) => Promise<void>
  onDelete: (id: number) => Promise<void>
}

type VersionAction = { type: 'restore' | 'delete'; version: SyncVersion } | null

export function SyncVersionHistory(props: Props) {
  const [action, setAction] = useState<VersionAction>(null)
  const confirm = async () => {
    if (!action) return
    const operation = action.type === 'restore' ? props.onRestore : props.onDelete
    try { await operation(action.version.id); setAction(null) } catch { /* error is shown by the controller */ }
  }
  return <section className="border-t border-border pt-5"><div className="mb-3 flex items-center gap-2"><History className="size-4" /><div><h4 className="text-sm font-medium">{t('本地版本历史')}</h4><p className="text-xs text-muted-foreground">{t('恢复前会关闭活动终端与隧道，并自动创建恢复点。')}</p></div></div>
    <div className="overflow-hidden rounded-xl border border-border">{props.versions.length === 0 ? <div className="px-4 py-8 text-center text-sm text-muted-foreground">{t('尚无本地版本')}</div> : props.versions.map((version) => <VersionRow key={version.id} version={version} disabled={props.pending !== null} onAction={(type) => setAction({ type, version })} />)}</div>
    <VersionActionDialog action={action} pending={props.pending !== null} onOpenChange={(open) => { if (!open && props.pending === null) setAction(null) }} onConfirm={() => void confirm()} />
  </section>
}

function VersionRow({ version, disabled, onAction }: { version: SyncVersion; disabled: boolean; onAction: (type: 'restore' | 'delete') => void }) {
  return <div className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{t('版本')} {version.version_number || t('恢复点')}</span>{version.protected && <Badge variant="secondary">{t('当前基线')}</Badge>}<Badge variant="outline">{version.source}</Badge></div><div className="mt-1 text-xs text-muted-foreground">{formatSyncDate(version.created_at)} · {formatSyncBytes(version.size_bytes)}</div></div><Button type="button" size="icon-sm" variant="ghost" aria-label={t('恢复版本 ${}', version.version_number)} disabled={disabled} onClick={() => onAction('restore')}><RotateCcw /></Button><Button type="button" size="icon-sm" variant="ghost" aria-label={t('删除版本 ${}', version.version_number)} disabled={disabled || version.protected} onClick={() => onAction('delete')}><Trash2 /></Button></div>
}

function VersionActionDialog(props: { action: VersionAction; pending: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void }) {
  const restoring = props.action?.type === 'restore'
  return <AlertDialog open={props.action !== null} onOpenChange={props.onOpenChange}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{restoring ? t('恢复此本地版本？') : t('删除此本地版本？')}</AlertDialogTitle><AlertDialogDescription>{restoring ? t('活动终端和隧道将被关闭，当前数据会先保存为恢复点。') : t('版本文件将永久删除，当前同步基线不能删除。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={props.pending}>{t('取消')}</AlertDialogCancel><AlertDialogAction variant={restoring ? 'default' : 'destructive'} disabled={props.pending} onClick={props.onConfirm}>{restoring ? t('确认恢复') : t('确认删除')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
}
