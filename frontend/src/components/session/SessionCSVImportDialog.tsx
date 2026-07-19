import { useMemo } from 'react'
import { FileUp, TriangleAlert } from 'lucide-react'
import type { SessionCSVImportRequest } from '@/hooks/useSessionCSVTransfer'
import { useSessionCSVImportDialog } from '@/hooks/useSessionCSVImportDialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { SessionCSVConflictPolicy, type SessionCSVImportResult, type SessionCSVImportSummary, type SessionCSVPreview } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { SESSION_CSV_TEMPLATES } from '@/lib/sessionCSVMapping'
import { SessionCSVMappingTable } from './SessionCSVMappingTable'

interface SessionCSVImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPreview: (path: string) => Promise<SessionCSVPreview>
  onImport: (request: SessionCSVImportRequest) => Promise<SessionCSVImportSummary>
}

export function SessionCSVImportDialog(props: SessionCSVImportDialogProps) {
  const state = useSessionCSVImportDialog(props.onPreview, props.onImport, props.onOpenChange)

  return <Dialog open={props.open} onOpenChange={state.changeOpen}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl"><DialogHeader><DialogTitle>导入会话 CSV</DialogTitle><DialogDescription>支持 MSSH 以及常见 PuTTY、SecureCRT、MobaXterm CSV 字段。厂商原生配置文件请先导出为 CSV。</DialogDescription></DialogHeader>
    {state.summary ? <SessionCSVImportSummaryView summary={state.summary} /> : <div className="flex flex-col gap-4"><div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" disabled={state.pending} onClick={() => { void state.selectFile() }}><FileUp data-icon="inline-start" />{state.preview ? '重新选择 CSV' : '选择 CSV 文件'}</Button>{state.path && <span className="max-w-full truncate text-xs text-muted-foreground">{state.path}</span>}</div>{state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      {state.preview && <><div className="rounded-xl border border-border bg-muted/20 p-3"><div className="mb-2 text-xs font-medium text-muted-foreground">来源模板</div><div className="grid gap-2 sm:grid-cols-5">{SESSION_CSV_TEMPLATES.map((template) => <Button key={template.id} type="button" variant={state.provider === template.id ? 'secondary' : 'outline'} className="h-auto min-h-14 justify-start text-left" onClick={() => state.applyProvider(template.id)}><span><span className="block text-sm font-medium">{template.label}</span><span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">{template.description}</span></span></Button>)}</div></div>
        <PreviewSummary preview={state.preview} />
        <SessionCSVMappingTable preview={state.preview} mapping={state.mapping} defaults={state.defaults} onMappingChange={state.setMapping} onDefaultChange={(key, value) => state.setDefaults((current) => ({ ...current, [key]: value }))} />
        {state.requiredMissing.length > 0 && <Alert variant="destructive"><TriangleAlert /><AlertDescription>还需要映射或填写：{state.requiredMissing.map((field) => field.label).join('、')}</AlertDescription></Alert>}
        <div className="grid gap-3 sm:grid-cols-2"><LabeledSelect ariaLabel="重复会话处理" value={state.policy} options={[{ value: SessionCSVConflictPolicy.SessionCSVConflictSkip, label: '跳过重复项' }, { value: SessionCSVConflictPolicy.SessionCSVConflictOverwrite, label: '覆盖重复项' }]} onValueChange={(value) => state.setPolicy(value as SessionCSVConflictPolicy)} /><p className="self-center text-xs leading-5 text-muted-foreground">重复项按名称、主机、端口和用户名识别。未映射或空单元格使用默认值。</p></div>
      </>}</div>}
    <DialogFooter>{state.summary ? <Button type="button" onClick={() => state.changeOpen(false)}>关闭</Button> : <><Button type="button" variant="outline" disabled={state.pending} onClick={() => state.changeOpen(false)}>取消</Button><Button type="button" disabled={state.pending || !state.preview || state.requiredMissing.length > 0} onClick={() => { void state.runImport() }}>{state.pending ? <><Spinner data-icon="inline-start" />处理中...</> : '确认导入'}</Button></>}</DialogFooter>
  </DialogContent></Dialog>
}

function PreviewSummary({ preview }: { preview: SessionCSVPreview }) {
  return <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>识别到 {preview.headers.length} 个表头</span><span>共 {preview.total_rows} 行</span><span>预览 {preview.sample_rows.length} 行</span></div>
}

function SessionCSVImportSummaryView({ summary }: { summary: SessionCSVImportSummary }) {
  const visible = useMemo(() => [...summary.results].sort((left, right) => Number(left.status !== 'failed') - Number(right.status !== 'failed')).slice(0, 100), [summary.results])
  return <div className="flex flex-col gap-4"><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><SummaryMetric label="新增" value={summary.imported} /><SummaryMetric label="更新" value={summary.updated} /><SummaryMetric label="跳过" value={summary.skipped} /><SummaryMetric label="失败" value={summary.failed} destructive={summary.failed > 0} /></div><div className="overflow-hidden rounded-xl border border-border"><div className="border-b border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">处理 {summary.total} 行，最多展示 100 条明细，失败项优先。</div><div className="max-h-72 overflow-y-auto">{visible.map((result) => <ImportResultRow key={`${result.row}-${result.name}`} result={result} />)}</div></div></div>
}

function ImportResultRow({ result }: { result: SessionCSVImportResult }) {
  return <div className="flex items-start gap-3 border-b border-border px-3 py-2 last:border-b-0"><Badge variant={result.status === 'failed' ? 'destructive' : result.status === 'skipped' ? 'outline' : 'secondary'}>{statusLabel(result.status)}</Badge><div className="min-w-0"><div className="truncate text-sm font-medium">第 {result.row} 行 · {result.name || result.host || '未命名会话'}</div>{result.error && <div className="mt-0.5 break-words text-xs text-destructive">{result.error}</div>}</div></div>
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
