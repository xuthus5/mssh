import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, ScrollText } from 'lucide-react'
import { AuditService } from '@/lib/wails'
import type { AuditEvent } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { useSessionWorkspace } from '@/hooks/SessionWorkspaceContext'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { AsyncState } from '@/components/ui/async-state'
import { t } from '@/i18n'


function auditActionOptions() {
  return [
    { value: '', label: t('全部动作') }, { value: 'connect', label: t('SSH 连接') },
    { value: 'export', label: t('导出配置') }, { value: 'import', label: t('导入配置') },
    { value: 'cloud_upload', label: t('云端上传') }, { value: 'cloud_download', label: t('云端下载') },
    { value: 'delete', label: t('删除资产') }, { value: 'key_view', label: t('查看密钥') },
    { value: 'batch_connect', label: t('批量连接') }, { value: 'batch_macro', label: t('批量宏') }, { value: 'batch_delete', label: t('批量删除') },
  ]
}

export function AuditPanel() {
  const { sessions } = useSessionWorkspace()
  const status = useAuditEnabled()
  const events = useAuditEvents(status.enabled, status.setError)
  const retry = () => { if (status.enabled) void events.load().catch(() => undefined); else void status.bootstrap() }
  return <section className="flex min-h-0 flex-1 flex-col overflow-auto bg-background p-5">
    <AuditHeader status={status} />
    <AuditCard sessions={sessions} status={status} events={events} retry={retry} />
  </section>
}

function useAuditEnabled() {
  const [enabled, setEnabled] = useState(false)
  const [initializing, setInitializing] = useState(true)
  const [toggling, setToggling] = useState(false)
  const [error, setError] = useState('')
  const lifecycle = useRef(0)
  const bootstrapActive = useRef(false)
  const toggleActive = useRef(false)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [])
  const bootstrap = useCallback(async () => {
    if (bootstrapActive.current) return
    bootstrapActive.current = true
    const lifecycleToken = lifecycle.current
    setInitializing(true)
    setError('')
    try {
      const next = await AuditService.Enabled()
      if (lifecycle.current === lifecycleToken) setEnabled(next)
    } catch (loadError: unknown) {
      const message = loadError instanceof Error ? loadError.message : String(loadError)
      if (lifecycle.current === lifecycleToken) setError(message)
    } finally {
      if (lifecycle.current === lifecycleToken) setInitializing(false)
      bootstrapActive.current = false
    }
  }, [])

  useEffect(() => { void bootstrap() }, [bootstrap])

  const toggle = (next: boolean) => toggleAudit({ next, lifecycle, toggleActive, setEnabled, setToggling, setError })
  return { enabled, initializing, toggling, error, setError, bootstrap, toggle }
}

type AuditStatus = ReturnType<typeof useAuditEnabled>

async function toggleAudit(options: {
  next: boolean
  lifecycle: { current: number }
  toggleActive: { current: boolean }
  setEnabled: (enabled: boolean) => void
  setToggling: (toggling: boolean) => void
  setError: (message: string) => void
}) {
  if (options.toggleActive.current) return
  options.toggleActive.current = true
  const lifecycleToken = options.lifecycle.current
  options.setToggling(true)
  options.setError('')
  try {
    await AuditService.SetEnabled(options.next)
    if (options.lifecycle.current === lifecycleToken) options.setEnabled(options.next)
  } catch (toggleError) {
    const message = toggleError instanceof Error ? toggleError.message : String(toggleError)
    if (options.lifecycle.current === lifecycleToken) options.setError(message)
  } finally {
    options.toggleActive.current = false
    if (options.lifecycle.current === lifecycleToken) options.setToggling(false)
  }
}

function useAuditEvents(enabled: boolean, setError: (message: string) => void) {
  const [action, setAction] = useState('')
  const [sessionID, setSessionID] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const listEvents = useCallback((filter: { action: string; session_id: number | null; from: string; to: string; limit: number }) => AuditService.List(filter), [])
  const query = useAsyncAction(listEvents, 'latest')
  const load = useCallback(async () => {
    if (!enabled) { query.reset(); return }
    setError('')
    await query.run({ action, session_id: sessionID ? Number(sessionID) : null, from: toISO(from), to: toISO(to), limit: 200 })
  }, [action, enabled, from, query.reset, query.run, sessionID, setError, to])
  useEffect(() => { void load().catch(() => undefined) }, [load])
  return { action, setAction, sessionID, setSessionID, from, setFrom, to, setTo, query, load }
}

type AuditEvents = ReturnType<typeof useAuditEvents>

function AuditHeader({ status }: { status: AuditStatus }) {
  return <header className="mb-5 flex items-center gap-3"><ScrollText className="size-5 text-primary" /><div><h1 className="text-xl font-semibold">{t('审计日志')}</h1><p className="text-sm text-muted-foreground">{t('记录关键资产与连接操作，不保存密码、密钥或命令正文')}</p></div><div className="ml-auto flex items-center gap-2 text-sm"><span>{status.enabled ? t('已启用') : t('已停用')}</span><Switch aria-label={t('启用审计日志')} checked={status.enabled} disabled={status.initializing || status.toggling} onCheckedChange={(value) => { void status.toggle(value) }} /></div></header>
}

function AuditCard({ sessions, status, events, retry }: {
  sessions: Array<{ id: string; name: string }>; status: AuditStatus; events: AuditEvents; retry: () => void
}) {
  return <Card><CardHeader className="flex flex-row items-center justify-between gap-4"><CardTitle className="text-sm">{t('操作记录')}</CardTitle><Button size="sm" variant="outline" disabled={!status.enabled || events.query.pending} onClick={retry}><RefreshCw />{t('刷新')}</Button></CardHeader><CardContent className="flex flex-col gap-4">
    <AuditFilters sessions={sessions} events={events} />
    <AuditResults sessions={sessions} status={status} events={events} retry={retry} />
  </CardContent></Card>
}

function AuditFilters({ sessions, events }: { sessions: Array<{ id: string; name: string }>; events: AuditEvents }) {
  const sessionOptions = [{ value: '', label: t('全部会话') }, ...sessions.map((session) => ({ value: session.id, label: session.name }))]
  return <div className="grid gap-3 md:grid-cols-4">
    <LabeledSelect ariaLabel={t('审计动作')} value={events.action} options={auditActionOptions()} onValueChange={events.setAction} />
    <LabeledSelect ariaLabel={t('审计会话')} value={events.sessionID} options={sessionOptions} onValueChange={events.setSessionID} />
    <Input aria-label={t('开始时间')} type="datetime-local" value={events.from} onChange={(event) => events.setFrom(event.target.value)} />
    <Input aria-label={t('结束时间')} type="datetime-local" value={events.to} onChange={(event) => events.setTo(event.target.value)} />
  </div>
}

function AuditResults({ sessions, status, events, retry }: {
  sessions: Array<{ id: string; name: string }>; status: AuditStatus; events: AuditEvents; retry: () => void
}) {
  const error = status.error || events.query.error
  if (error) return <AsyncState pending={false} error={error} empty={false} emptyText="" onRetry={retry}><div /></AsyncState>
  if (!status.enabled && !status.initializing) return <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{t('启用审计日志后开始记录关键操作。')}</p>
  return <AsyncState pending={status.initializing || events.query.pending} error={error} empty={(events.query.result?.length ?? 0) === 0} emptyText={t('当前筛选条件下暂无审计记录。')} onRetry={retry}><AuditTable events={events.query.result ?? []} sessions={sessions} /></AsyncState>
}

function AuditTable({ events, sessions }: { events: AuditEvent[]; sessions: Array<{ id: string; name: string }> }) {
  const actionOptions = auditActionOptions()
  return <div className="overflow-hidden rounded-xl border border-border"><Table><TableHeader><TableRow><TableHead>{t('时间')}</TableHead><TableHead>{t('动作')}</TableHead><TableHead>{t('会话')}</TableHead><TableHead>{t('摘要')}</TableHead><TableHead>{t('结果')}</TableHead></TableRow></TableHeader><TableBody>{events.map((event) => <TableRow key={event.id}><TableCell>{new Date(event.created_at).toLocaleString()}</TableCell><TableCell>{actionOptions.find((option) => option.value === event.action)?.label ?? event.action}</TableCell><TableCell>{sessions.find((session) => Number(session.id) === event.session_id)?.name ?? (event.target_id || '-')}</TableCell><TableCell>{event.summary}</TableCell><TableCell><Badge variant={event.outcome === 'success' ? 'default' : 'destructive'}>{event.outcome === 'success' ? t('成功') : t('失败')}</Badge></TableCell></TableRow>)}</TableBody></Table></div>
}

function toISO(value: string) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}
