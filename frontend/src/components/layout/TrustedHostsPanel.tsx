import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Folder as FolderIcon, RefreshCw, Search, ShieldCheck, Trash2 } from 'lucide-react'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SessionService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { t } from '@/i18n'
import { syncDataChangedEvent } from '@/lib/syncDataReload'
import { Events } from '@wailsio/runtime'
import { useSessionWorkspace } from '@/hooks/SessionWorkspaceContext'
import { matchSessionsForTrustedHost, normalizeTrustedHost, trustedHostFolderNames, trustedHostMatches } from '@/lib/trustedHostMatching'
import type { Session } from '@/lib/sessionModels'

export type TrustedHostEntry = { line: number; hosts: string; algorithm: string; fingerprint: string }

type PendingDelete = { line: number; hosts: string } | null

type EnrichedTrustedHost = TrustedHostEntry & { sessions: Session[] }

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
  const workspace = useSessionWorkspace()
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null)
  const [query, setQuery] = useState('')
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
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('搜索主机、会话、分组或指纹...')} className="h-8 pl-8 text-sm" />
          </div>
          <TrustedHostsContent model={model} sessions={workspace.sessions} folders={workspace.folders} query={query} onDelete={setPendingDelete} />
        </CardContent>
      </Card>
      <TrustedHostDeleteDialog pendingDelete={pendingDelete} deleting={model.deleting} error={model.deleteError} onOpenChange={(open) => { if (!open) setPendingDelete(null) }} onConfirm={async () => { if (!pendingDelete) return; const ok = await model.remove(pendingDelete.line); if (ok) setPendingDelete(null) }} />
    </section>
  )
}

function TrustedHostsContent({ model, sessions, folders, query, onDelete }: {
  model: ReturnType<typeof useTrustedHosts>
  sessions: Session[]
  folders: ReturnType<typeof useSessionWorkspace>['folders']
  query: string
  onDelete: (entry: TrustedHostEntry) => void
}) {
  const folderNames = useMemo(() => trustedHostFolderNames(folders), [folders])
  const entries = useMemo(() => enrichTrustedHosts({ entries: model.entries, sessions, folderNames, query }), [folderNames, model.entries, query, sessions])
  if (model.loading) return <p className="text-sm text-muted-foreground">{t('正在加载主机指纹...')}</p>
  if (model.error) return <p className="text-sm text-muted-foreground">{t('主机指纹暂不可用，请先修复上方加载错误。')}</p>
  if (model.entries.length === 0) return <p className="text-sm text-muted-foreground">{t('尚未信任任何 SSH 主机。')}</p>
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">{t('没有匹配的已信任主机。')}</p>
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('主机')}</TableHead>
            <TableHead>{t('会话 / 分组')}</TableHead>
            <TableHead>{t('认证')}</TableHead>
            <TableHead>{t('指纹')}</TableHead>
            <TableHead className="text-right">{t('操作')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => <TrustedHostRow key={`${entry.line}-${entry.fingerprint}`} entry={entry} folderNames={folderNames} deleting={model.deleting} onDelete={onDelete} />)}
        </TableBody>
      </Table>
    </div>
  )
}

function enrichTrustedHosts(options: {
  entries: TrustedHostEntry[]
  sessions: Session[]
  folderNames: Map<string, string>
  query: string
}): EnrichedTrustedHost[] {
  const { entries, sessions, folderNames, query } = options
  return entries
    .map((entry) => ({ ...entry, sessions: matchSessionsForTrustedHost(entry.hosts, sessions) }))
    .filter((entry) => trustedHostMatches({ hosts: entry.hosts, sessions: entry.sessions, folderNames, algorithm: entry.algorithm, fingerprint: entry.fingerprint, query }))
}

function TrustedHostRow({ entry, folderNames, deleting, onDelete }: {
  entry: EnrichedTrustedHost
  folderNames: Map<string, string>
  deleting: boolean
  onDelete: (entry: TrustedHostEntry) => void
}) {
  const primary = entry.sessions[0]
  const folderName = primary?.folderId ? folderNames.get(primary.folderId) : undefined
  return (
    <TableRow>
      <TableCell className="font-mono text-sm">{entry.hosts}</TableCell>
      <TableCell>
        {primary ? (
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{primary.name}</span>
              <span className="text-xs text-muted-foreground">{primary.username}</span>
            </div>
            <div className="flex items-center gap-1.5">
              {folderName ? <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><FolderIcon className="size-3" />{folderName}</span> : null}
              {primary.environment ? <Badge variant="outline" data-asset-color={primary.environment.colorToken} className="asset-color-badge">{primary.environment.name}</Badge> : null}
              {primary.project ? <Badge variant="secondary">{primary.project.code || primary.project.name}</Badge> : null}
              {(primary.tags ?? []).slice(0, 1).map((tag) => <Badge key={tag.id} variant="outline" data-asset-color={tag.colorToken} className="asset-color-badge">{tag.name}</Badge>)}
              {(primary.tags ?? []).length > 1 ? <span className="text-xs text-muted-foreground">+{(primary.tags ?? []).length - 1}</span> : null}
            </div>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">{t('未关联会话')}</span>
        )}
      </TableCell>
      <TableCell><span className="text-xs text-muted-foreground">{entry.algorithm}</span></TableCell>
      <TableCell><span className="truncate font-mono text-xs text-muted-foreground">{entry.fingerprint}</span></TableCell>
      <TableCell className="text-right">
        <Button size="icon-xs" variant="ghost" disabled={deleting} aria-label={t('删除 ${} 的主机指纹', entry.hosts)} onClick={() => onDelete(entry)}><Trash2 /></Button>
      </TableCell>
    </TableRow>
  )
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
