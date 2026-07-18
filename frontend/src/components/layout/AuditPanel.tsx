import { useCallback, useEffect, useState } from 'react'
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

const actionOptions = [
  { value: '', label: '全部动作' }, { value: 'connect', label: 'SSH 连接' },
  { value: 'export', label: '导出配置' }, { value: 'import', label: '导入配置' },
  { value: 'cloud_upload', label: '云端上传' }, { value: 'cloud_download', label: '云端下载' },
  { value: 'delete', label: '删除资产' }, { value: 'key_view', label: '查看密钥' },
  { value: 'batch_connect', label: '批量连接' }, { value: 'batch_macro', label: '批量宏' },
]

export function AuditPanel() {
  const { sessions } = useSessionWorkspace()
  const [enabled, setEnabled] = useState(false)
  const [action, setAction] = useState('')
  const [sessionID, setSessionID] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [initializing, setInitializing] = useState(true)
  const [error, setError] = useState('')
  const listEvents = useCallback((filter: { action: string; session_id: number | null; from: string; to: string; limit: number }) => AuditService.List(filter), [])
  const query = useAsyncAction(listEvents, 'latest')
  const load = useCallback(async () => {
    if (!enabled) { query.reset(); return }
    await query.run({ action, session_id: sessionID ? Number(sessionID) : null, from: toISO(from), to: toISO(to), limit: 200 })
  }, [action, enabled, from, query.reset, query.run, sessionID, to])
  useEffect(() => { void AuditService.Enabled().then(setEnabled).catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : String(loadError))).finally(() => setInitializing(false)) }, [])
  useEffect(() => { void load().catch(() => undefined) }, [load])
  const toggle = async (next: boolean) => {
    try { await AuditService.SetEnabled(next); setEnabled(next) } catch (toggleError) { setError(toggleError instanceof Error ? toggleError.message : String(toggleError)) }
  }
  return <section className="flex min-h-0 flex-1 flex-col overflow-auto bg-background p-5">
    <header className="mb-5 flex items-center gap-3"><ScrollText className="size-5 text-primary" /><div><h1 className="text-xl font-semibold">审计日志</h1><p className="text-sm text-muted-foreground">记录关键资产与连接操作，不保存密码、密钥或命令正文</p></div><div className="ml-auto flex items-center gap-2 text-sm"><span>{enabled ? '已启用' : '已停用'}</span><Switch aria-label="启用审计日志" checked={enabled} onCheckedChange={(value) => { void toggle(value) }} /></div></header>
    <Card><CardHeader className="flex flex-row items-center justify-between gap-4"><CardTitle className="text-sm">操作记录</CardTitle><Button size="sm" variant="outline" disabled={!enabled || query.pending} onClick={() => { void load().catch(() => undefined) }}><RefreshCw />刷新</Button></CardHeader><CardContent className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-4"><LabeledSelect ariaLabel="审计动作" value={action} options={actionOptions} onValueChange={setAction} /><LabeledSelect ariaLabel="审计会话" value={sessionID} options={[{ value: '', label: '全部会话' }, ...sessions.map((session) => ({ value: session.id, label: session.name }))]} onValueChange={setSessionID} /><Input aria-label="开始时间" type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} /><Input aria-label="结束时间" type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} /></div>
      {!enabled && !initializing ? <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">启用审计日志后开始记录关键操作。</p> : <AsyncState pending={initializing || query.pending} error={error || query.error} empty={(query.result?.length ?? 0) === 0} emptyText="当前筛选条件下暂无审计记录。" onRetry={() => { void load().catch(() => undefined) }}><AuditTable events={query.result ?? []} sessions={sessions} /></AsyncState>}
    </CardContent></Card>
  </section>
}

function AuditTable({ events, sessions }: { events: AuditEvent[]; sessions: Array<{ id: string; name: string }> }) {
  return <div className="overflow-hidden rounded-xl border border-border"><Table><TableHeader><TableRow><TableHead>时间</TableHead><TableHead>动作</TableHead><TableHead>会话</TableHead><TableHead>摘要</TableHead><TableHead>结果</TableHead></TableRow></TableHeader><TableBody>{events.map((event) => <TableRow key={event.id}><TableCell>{new Date(event.created_at).toLocaleString()}</TableCell><TableCell>{actionOptions.find((option) => option.value === event.action)?.label ?? event.action}</TableCell><TableCell>{sessions.find((session) => Number(session.id) === event.session_id)?.name ?? (event.target_id || '-')}</TableCell><TableCell>{event.summary}</TableCell><TableCell><Badge variant={event.outcome === 'success' ? 'default' : 'destructive'}>{event.outcome === 'success' ? '成功' : '失败'}</Badge></TableCell></TableRow>)}</TableBody></Table></div>
}

function toISO(value: string) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}
