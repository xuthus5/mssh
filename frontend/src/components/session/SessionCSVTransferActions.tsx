import { useMemo, useState } from 'react'
import { Dialogs } from '@wailsio/runtime'
import { FileDown, FileUp, TriangleAlert } from 'lucide-react'
import { useSessionWorkspace } from '@/hooks/SessionWorkspaceContext'
import type { SessionCSVExportRequest } from '@/hooks/useSessionCSVTransfer'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { toast } from '@/components/ui/toast'
import { SessionCSVConflictPolicy, type SessionCSVExportResult, type SessionCSVImportSummary } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

type ExportSessions = (request: SessionCSVExportRequest) => Promise<SessionCSVExportResult>
type ImportSessions = (path: string, policy: SessionCSVConflictPolicy) => Promise<SessionCSVImportSummary>

export function SessionCSVTransferActions({ selectedIDs }: { selectedIDs: string[] }) {
  const { exportSessionsCSV, importSessionsCSV } = useSessionWorkspace()
  const [exportOpen, setExportOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  return <>
    <Button type="button" variant="outline" onClick={() => setImportOpen(true)}><FileUp data-icon="inline-start" />导入</Button>
    <Button type="button" variant="outline" onClick={() => setExportOpen(true)}><FileDown data-icon="inline-start" />导出</Button>
    <SessionCSVExportDialog open={exportOpen} selectedIDs={selectedIDs} onOpenChange={setExportOpen} onExport={exportSessionsCSV} />
    <SessionCSVImportDialog open={importOpen} onOpenChange={setImportOpen} onImport={importSessionsCSV} />
  </>
}

interface ExportDialogProps {
  open: boolean
  selectedIDs: string[]
  onOpenChange: (open: boolean) => void
  onExport: ExportSessions
}

function SessionCSVExportDialog(props: ExportDialogProps) {
  const [scope, setScope] = useState<'all' | 'selected'>('all')
  const [includePasswords, setIncludePasswords] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const selectedAvailable = props.selectedIDs.length > 0
  const effectiveScope = scope === 'selected' && selectedAvailable ? 'selected' : 'all'

  const changeOpen = (open: boolean) => {
    if (pending) return
    if (!open) { setScope('all'); setIncludePasswords(false); setError('') }
    props.onOpenChange(open)
  }

  const runExport = async () => {
    setPending(true); setError('')
    try {
      const path = await Dialogs.SaveFile({ Title: '导出 SSH 会话 CSV', Filename: sessionCSVFileName(), CanCreateDirectories: true, Filters: [{ DisplayName: 'CSV', Pattern: '*.csv' }] })
      if (!path) return
      const result = await props.onExport({ path: ensureCSVExtension(path), sessionIDs: effectiveScope === 'selected' ? props.selectedIDs : [], includePasswords })
      toast(`已导出 ${result.count} 个会话`, 'success'); changeOpen(false)
    } catch (reason) { setError(errorMessage(reason)) } finally { setPending(false) }
  }

  return <Dialog open={props.open} onOpenChange={changeOpen}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>导出会话 CSV</DialogTitle><DialogDescription>仅导出 SSH 会话、分组和资产归属，不包含 MSSH 应用设置。</DialogDescription></DialogHeader>
    <div className="flex flex-col gap-4"><SegmentedControl label="导出范围" options={[{ value: 'all', label: '全部会话' }, ...(selectedAvailable ? [{ value: 'selected', label: `已选 ${props.selectedIDs.length} 项` } as const] : [])]} value={effectiveScope} onChange={(value) => setScope(value as 'all' | 'selected')} />
      <label className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm"><Checkbox checked={includePasswords} onCheckedChange={(checked) => setIncludePasswords(checked === true)} /><span><span className="block font-medium">包含已保存密码</span><span className="mt-0.5 block text-xs text-muted-foreground">默认关闭。密钥认证仅导出公钥标识，不导出私钥。</span></span></label>
      {includePasswords && <Alert variant="destructive"><TriangleAlert /><AlertDescription>密码将以明文写入 CSV。请仅保存到可信位置，并在使用后妥善删除。</AlertDescription></Alert>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div><DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={() => changeOpen(false)}>取消</Button><Button type="button" disabled={pending} onClick={() => { void runExport() }}>{pending ? <><Spinner data-icon="inline-start" />导出中...</> : <><FileDown data-icon="inline-start" />选择位置并导出</>}</Button></DialogFooter>
  </DialogContent></Dialog>
}

interface ImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImport: ImportSessions
}

function SessionCSVImportDialog(props: ImportDialogProps) {
  const [policy, setPolicy] = useState(SessionCSVConflictPolicy.SessionCSVConflictSkip)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState<SessionCSVImportSummary | null>(null)

  const runImport = async () => {
    setPending(true); setError(''); setSummary(null)
    try {
      const selected = await Dialogs.OpenFile({ Title: '导入 SSH 会话 CSV', CanChooseFiles: true, CanChooseDirectories: false, AllowsMultipleSelection: false, Filters: [{ DisplayName: 'CSV', Pattern: '*.csv' }] })
      const path = typeof selected === 'string' ? selected : Array.isArray(selected) ? selected[0] : ''
      if (!path) return
      const result = await props.onImport(path, policy)
      setSummary(result); toast(`会话导入完成：新增 ${result.imported}，更新 ${result.updated}`, result.failed > 0 ? 'info' : 'success')
    } catch (reason) { setError(errorMessage(reason)) } finally { setPending(false) }
  }

  const changeOpen = (open: boolean) => {
    if (pending) return
    if (!open) { setPolicy(SessionCSVConflictPolicy.SessionCSVConflictSkip); setSummary(null); setError('') }
    props.onOpenChange(open)
  }

  return <Dialog open={props.open} onOpenChange={changeOpen}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>导入会话 CSV</DialogTitle><DialogDescription>缺失的分组、环境、项目和标签会自动创建。此操作不会改动应用设置。</DialogDescription></DialogHeader>
    {summary ? <SessionCSVImportSummaryView summary={summary} /> : <div className="flex flex-col gap-4"><SegmentedControl label="重复会话处理" options={[{ value: SessionCSVConflictPolicy.SessionCSVConflictSkip, label: '跳过重复项' }, { value: SessionCSVConflictPolicy.SessionCSVConflictOverwrite, label: '覆盖重复项' }]} value={policy} onChange={(value) => setPolicy(value as SessionCSVConflictPolicy)} />
      <p className="text-xs leading-5 text-muted-foreground">重复项按名称、主机、端口和用户名识别。覆盖时，CSV 密码为空会保留本地已有密码。</p>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}</div>}
    <DialogFooter>{summary ? <Button type="button" onClick={() => changeOpen(false)}>关闭</Button> : <><Button type="button" variant="outline" disabled={pending} onClick={() => changeOpen(false)}>取消</Button><Button type="button" disabled={pending} onClick={() => { void runImport() }}>{pending ? <><Spinner data-icon="inline-start" />导入中...</> : <><FileUp data-icon="inline-start" />选择 CSV 并导入</>}</Button></>}</DialogFooter>
  </DialogContent></Dialog>
}

interface SegmentedOption { value: string; label: string }

function SegmentedControl(props: { label: string; options: SegmentedOption[]; value: string; onChange: (value: string) => void }) {
  return <div><div className="mb-2 text-xs font-medium text-muted-foreground">{props.label}</div><div role="group" aria-label={props.label} className="flex gap-1 rounded-xl border border-border bg-muted/40 p-1">{props.options.map((option) => <Button key={option.value} type="button" size="sm" className="flex-1" variant={props.value === option.value ? 'secondary' : 'ghost'} onClick={() => props.onChange(option.value)}>{option.label}</Button>)}</div></div>
}

function SessionCSVImportSummaryView({ summary }: { summary: SessionCSVImportSummary }) {
  const visible = useMemo(() => [...summary.results].sort((left, right) => Number(left.status !== 'failed') - Number(right.status !== 'failed')).slice(0, 100), [summary.results])
  return <div className="flex flex-col gap-4"><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><SummaryMetric label="新增" value={summary.imported} /><SummaryMetric label="更新" value={summary.updated} /><SummaryMetric label="跳过" value={summary.skipped} /><SummaryMetric label="失败" value={summary.failed} destructive={summary.failed > 0} /></div>
    <div className="overflow-hidden rounded-xl border border-border"><div className="border-b border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">处理 {summary.total} 行，最多展示 100 条明细，失败项优先。</div><div className="max-h-72 overflow-y-auto">{visible.map((result) => <div key={`${result.row}-${result.name}`} className="flex items-start gap-3 border-b border-border px-3 py-2 last:border-b-0"><Badge variant={result.status === 'failed' ? 'destructive' : result.status === 'skipped' ? 'outline' : 'secondary'}>{statusLabel(result.status)}</Badge><div className="min-w-0"><div className="truncate text-sm font-medium">第 {result.row} 行 · {result.name || result.host || '未命名会话'}</div>{result.error && <div className="mt-0.5 break-words text-xs text-destructive">{result.error}</div>}</div></div>)}</div></div>
  </div>
}

function SummaryMetric({ label, value, destructive = false }: { label: string; value: number; destructive?: boolean }) {
  return <div className="rounded-xl border border-border px-3 py-2"><div className="text-xs text-muted-foreground">{label}</div><div className={destructive ? 'mt-1 text-lg font-semibold text-destructive' : 'mt-1 text-lg font-semibold text-foreground'}>{value}</div></div>
}

function statusLabel(status: string) {
  if (status === 'imported') return '新增'
  if (status === 'updated') return '更新'
  if (status === 'skipped') return '跳过'
  return '失败'
}

function sessionCSVFileName() { return `mssh-sessions-${new Date().toISOString().slice(0, 10)}.csv` }
function ensureCSVExtension(path: string) { return path.toLowerCase().endsWith('.csv') ? path : `${path}.csv` }
function errorMessage(reason: unknown) { return reason instanceof Error ? reason.message : String(reason) }
