import { useState } from 'react'
import { Dialogs } from '@wailsio/runtime'
import { FileDown, FileUp, TriangleAlert } from 'lucide-react'
import { useSessionWorkspace } from '@/hooks/SessionWorkspaceContext'
import type { SessionCSVExportRequest } from '@/hooks/useSessionCSVTransfer'
import { SessionCSVImportDialog } from './SessionCSVImportDialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { toast } from '@/components/ui/toast'
import type { SessionCSVExportResult } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { t } from '@/i18n'


type ExportSessions = (request: SessionCSVExportRequest) => Promise<SessionCSVExportResult>

export function SessionCSVTransferActions({ selectedIDs }: { selectedIDs: string[] }) {
  const { exportSessionsCSV, previewSessionsCSV, importSessionsCSV } = useSessionWorkspace()
  const [exportOpen, setExportOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  return <>
    <Button type="button" variant="outline" onClick={() => setImportOpen(true)}><FileUp data-icon="inline-start" />{t('导入')}</Button>
    <Button type="button" variant="outline" onClick={() => setExportOpen(true)}><FileDown data-icon="inline-start" />{t('导出')}</Button>
    <SessionCSVExportDialog open={exportOpen} selectedIDs={selectedIDs} onOpenChange={setExportOpen} onExport={exportSessionsCSV} />
    <SessionCSVImportDialog open={importOpen} onOpenChange={setImportOpen} onPreview={previewSessionsCSV} onImport={importSessionsCSV} />
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
      const path = await Dialogs.SaveFile({ Title: t('导出 SSH 会话 CSV'), Filename: sessionCSVFileName(), CanCreateDirectories: true, Filters: [{ DisplayName: 'CSV', Pattern: '*.csv' }] })
      if (!path) return
      const result = await props.onExport({ path: ensureCSVExtension(path), sessionIDs: effectiveScope === 'selected' ? props.selectedIDs : [], includePasswords })
      toast(t('已导出 ${} 个会话', result.count), 'success'); changeOpen(false)
    } catch (reason) { setError(errorMessage(reason)) } finally { setPending(false) }
  }

  return <Dialog open={props.open} onOpenChange={changeOpen}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>{t('导出会话 CSV')}</DialogTitle><DialogDescription>{t('仅导出 SSH 会话、分组和资产归属，不包含 MSSH 应用设置。')}</DialogDescription></DialogHeader>
    <div className="flex flex-col gap-4"><SegmentedControl label={t('导出范围')} options={[{ value: 'all', label: t('全部会话') }, ...(selectedAvailable ? [{ value: 'selected', label: `已选 ${props.selectedIDs.length} 项` } as const] : [])]} value={effectiveScope} onChange={(value) => setScope(value as 'all' | 'selected')} />
      <label className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm"><Checkbox checked={includePasswords} onCheckedChange={(checked) => setIncludePasswords(checked === true)} /><span><span className="block font-medium">{t('包含已保存密码')}</span><span className="mt-0.5 block text-xs text-muted-foreground">{t('默认关闭。密钥认证仅导出公钥标识，不导出私钥。')}</span></span></label>
      {includePasswords && <Alert variant="destructive"><TriangleAlert /><AlertDescription>{t('密码将以明文写入 CSV。请仅保存到可信位置，并在使用后妥善删除。')}</AlertDescription></Alert>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div><DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={() => changeOpen(false)}>{t('取消')}</Button><Button type="button" disabled={pending} onClick={() => { void runExport() }}>{pending ? <><Spinner data-icon="inline-start" />{t('导出中...')}</> : <><FileDown data-icon="inline-start" />{t('选择位置并导出')}</>}</Button></DialogFooter>
  </DialogContent></Dialog>
}

interface SegmentedOption { value: string; label: string }

function SegmentedControl(props: { label: string; options: SegmentedOption[]; value: string; onChange: (value: string) => void }) {
  return <div><div className="mb-2 text-xs font-medium text-muted-foreground">{props.label}</div><div role="group" aria-label={props.label} className="flex gap-1 rounded-xl border border-border bg-muted/40 p-1">{props.options.map((option) => <Button key={option.value} type="button" size="sm" className="flex-1" variant={props.value === option.value ? 'secondary' : 'ghost'} onClick={() => props.onChange(option.value)}>{option.label}</Button>)}</div></div>
}

function sessionCSVFileName() { return `mssh-sessions-${new Date().toISOString().slice(0, 10)}.csv` }
function ensureCSVExtension(path: string) { return path.toLowerCase().endsWith('.csv') ? path : `${path}.csv` }
function errorMessage(reason: unknown) { return reason instanceof Error ? reason.message : String(reason) }
