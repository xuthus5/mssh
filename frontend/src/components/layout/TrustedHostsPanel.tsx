import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SessionService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { t } from '@/i18n'
import { syncDataChangedEvent } from '@/lib/syncDataReload'
import { Events } from '@wailsio/runtime'

export type TrustedHostEntry = { line: number; hosts: string; algorithm: string; fingerprint: string }

type PendingDelete = { line: number; hosts: string } | null

function trustedHostsRequestID(requestID: { current: number }) {
  return ++requestID.current
}

function useTrustedHostsLifecycle() {
  const lifecycle = useRef(0)
  const requestID = useRef(0)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => {
      if (lifecycle.current === token) lifecycle.current++
    }
  }, [])
  return useMemo(() => ({ lifecycle, requestID }), [])
}

function useTrustedHosts() {
  const runtime = useTrustedHostsLifecycle()
  const [entries, setEntries] = useState<TrustedHostEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const load = useCallback(() => loadTrustedHosts({ runtime, setEntries, setLoading, setError }), [runtime])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const reload = () => { void load() }
    const stop = Events.On(syncDataChangedEvent, reload)
    return () => { stop() }
  }, [load])
  const remove = useCallback((line: number) => removeTrustedHost({ runtime, setEntries, setDeleting, setDeleteError, line }), [runtime])
  return { entries, loading, error, deleting, deleteError, load, remove }
}

function loadTrustedHosts(options: {
  runtime: ReturnType<typeof useTrustedHostsLifecycle>
  setEntries: (value: TrustedHostEntry[]) => void
  setLoading: (value: boolean) => void
  setError: (value: string) => void
}) {
  const { runtime, setEntries, setLoading, setError } = options
  const request = trustedHostsRequestID(runtime.requestID)
  const lifecycleToken = runtime.lifecycle.current
  const isCurrent = () => runtime.requestID.current === request && runtime.lifecycle.current === lifecycleToken
  setLoading(true)
  return SessionService.ListHostKeys().then((list) => {
    if (!isCurrent()) return
    setEntries(list ?? [])
    setError('')
  }).catch((loadError) => {
    if (!isCurrent()) return
    logger.error('load trusted hosts failed', loadError)
    setError(loadError instanceof Error ? loadError.message : String(loadError))
  }).finally(() => {
    if (isCurrent()) setLoading(false)
  })
}

async function removeTrustedHost(options: {
  runtime: ReturnType<typeof useTrustedHostsLifecycle>
  setEntries: (value: (current: TrustedHostEntry[]) => TrustedHostEntry[]) => void
  setDeleting: (value: boolean) => void
  setDeleteError: (value: string) => void
  line: number
}): Promise<boolean> {
  const { runtime, setEntries, setDeleting, setDeleteError, line } = options
  const request = trustedHostsRequestID(runtime.requestID)
  const lifecycleToken = runtime.lifecycle.current
  const isCurrent = () => runtime.requestID.current === request && runtime.lifecycle.current === lifecycleToken
  setDeleting(true)
  setDeleteError('')
  try {
    await SessionService.DeleteHostKey(line)
    if (!isCurrent()) return true
    setEntries((current) => current.filter((entry) => entry.line !== line))
    return true
  } catch (removeError) {
    if (!isCurrent()) return false
    logger.error('delete trusted host failed', removeError)
    setDeleteError(removeError instanceof Error ? removeError.message : String(removeError))
    return false
  } finally {
    if (isCurrent()) setDeleting(false)
  }
}

export function TrustedHostsPanel() {
  const model = useTrustedHosts()
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null)
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-auto bg-background p-5">
      <header className="mb-5 flex items-center gap-3">
        <ShieldCheck className="size-5 text-primary" />
        <div>
          <h1 className="text-xl font-semibold">{t('已信任主机')}</h1>
          <p className="text-sm text-muted-foreground">{t('管理 SSH known_hosts 指纹，在指纹变化时保护连接安全。')}</p>
        </div>
        <Button type="button" size="sm" variant="outline" className="ml-auto" disabled={model.loading} onClick={() => { void model.load() }}>
          <RefreshCw data-icon="inline-start" />{t('刷新')}
        </Button>
      </header>
      {model.error ? <div className="mb-3 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{t('加载已信任主机失败: ${}', model.error)}<Button size="xs" variant="outline" className="ml-2" onClick={() => { void model.load() }}>{t('重试')}</Button></div> : null}
      <Card>
        <CardContent className="space-y-2">
          <TrustedHostsContent model={model} onDelete={setPendingDelete} />
        </CardContent>
      </Card>
      <TrustedHostDeleteDialog pendingDelete={pendingDelete} deleting={model.deleting} error={model.deleteError} onOpenChange={(open) => { if (!open) setPendingDelete(null) }} onConfirm={async () => { if (!pendingDelete) return; const ok = await model.remove(pendingDelete.line); if (ok) setPendingDelete(null) }} />
    </section>
  )
}

function TrustedHostsContent({ model, onDelete }: {
  model: ReturnType<typeof useTrustedHosts>
  onDelete: (entry: TrustedHostEntry) => void
}) {
  if (model.loading) return <p className="text-sm text-muted-foreground">{t('正在加载主机指纹...')}</p>
  if (model.error) return <p className="text-sm text-muted-foreground">{t('主机指纹暂不可用，请先修复上方加载错误。')}</p>
  if (model.entries.length === 0) return <p className="text-sm text-muted-foreground">{t('尚未信任任何 SSH 主机。')}</p>
  return model.entries.map((entry) => (
    <div key={`${entry.line}-${entry.fingerprint}`} className="flex items-center gap-3 rounded-xl border border-border p-3">
      <ShieldCheck className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{entry.hosts}</div>
        <div className="truncate font-mono text-xs text-muted-foreground">{entry.algorithm} · {entry.fingerprint}</div>
      </div>
      <Button size="icon-xs" variant="ghost" disabled={model.deleting} aria-label={t('删除 ${} 的主机指纹', entry.hosts)} onClick={() => onDelete(entry)}><Trash2 /></Button>
    </div>
  ))
}

function TrustedHostDeleteDialog({ pendingDelete, deleting, error, onOpenChange, onConfirm }: {
  pendingDelete: PendingDelete
  deleting: boolean
  error: string
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={pendingDelete !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('删除 ${} 的已信任主机指纹？', pendingDelete?.hosts ?? '')}</AlertDialogTitle>
          <AlertDialogDescription>{t('下次连接时将重新确认该主机的指纹。')}</AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{t('删除主机指纹失败: ${}', error)}</div> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>{t('取消')}</AlertDialogCancel>
          <AlertDialogAction type="button" variant="destructive" disabled={deleting} onClick={(event) => { event.preventDefault(); onConfirm() }}>
            {deleting ? t('处理中…') : t('确认')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
