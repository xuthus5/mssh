import { useState } from 'react'
import { FileDown, FileUp, TriangleAlert } from 'lucide-react'
import { useSessionWorkspace } from '@/hooks/SessionWorkspaceContext'
import { SessionCSVImportDialog } from './SessionCSVImportDialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { t } from '@/i18n'
import { useSessionCSVExportDialog } from '@/components/session/useSessionCSVExportDialog'
import { useSessionCSVTransferAction } from '@/components/session/sessionCSVTransferGate'


export function SessionCSVTransferActions({ selectedIDs }: { selectedIDs: string[] }) {
  const { exportSessionsCSV, previewSessionsCSV, importSessionsCSV } = useSessionWorkspace()
  const [exportOpen, setExportOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const activeTransfer = useSessionCSVTransferAction()
  return <>
    <Button type="button" variant="outline" disabled={activeTransfer !== null} onClick={() => setImportOpen(true)}><FileUp data-icon="inline-start" />{t('导入')}</Button>
    <Button type="button" variant="outline" disabled={activeTransfer !== null} onClick={() => setExportOpen(true)}><FileDown data-icon="inline-start" />{t('导出')}</Button>
    <SessionCSVExportDialog open={exportOpen} selectedIDs={selectedIDs} onOpenChange={setExportOpen} onExport={exportSessionsCSV} />
    <SessionCSVImportDialog open={importOpen} onOpenChange={setImportOpen} onPreview={previewSessionsCSV} onImport={importSessionsCSV} />
  </>
}

interface ExportDialogProps {
  open: boolean
  selectedIDs: string[]
  onOpenChange: (open: boolean) => void
  onExport: ReturnType<typeof useSessionWorkspace>['exportSessionsCSV']
}

function SessionCSVExportDialog(props: ExportDialogProps) {
  const dialog = useSessionCSVExportDialog(props)

  return <Dialog open={props.open} onOpenChange={dialog.changeOpen}><DialogContent className="sm:max-w-lg" aria-busy={dialog.pending}><DialogHeader><DialogTitle>{t('导出会话 CSV')}</DialogTitle><DialogDescription>{t('仅导出 SSH 会话、分组和资产归属，不包含 MSSH 应用设置。')}</DialogDescription></DialogHeader>
    <div className="flex flex-col gap-4"><SegmentedControl label={t('导出范围')} options={[{ value: 'all', label: t('全部会话') }, ...(dialog.selectedAvailable ? [{ value: 'selected', label: t('已选 ${} 项', props.selectedIDs.length) } as const] : [])]} value={dialog.effectiveScope} disabled={dialog.pending} onChange={(value) => dialog.setScope(value as 'all' | 'selected')} />
      <label className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm"><Checkbox checked={dialog.includePasswords} disabled={dialog.pending} onCheckedChange={(checked) => dialog.setIncludePasswords(checked === true)} /><span><span className="block font-medium">{t('包含已保存密码')}</span><span className="mt-0.5 block text-xs text-muted-foreground">{t('默认关闭。密钥认证仅导出公钥标识，不导出私钥。')}</span></span></label>
      {dialog.includePasswords && <Alert variant="destructive"><TriangleAlert /><AlertDescription>{t('密码将以明文写入 CSV。请仅保存到可信位置，并在使用后妥善删除。')}</AlertDescription></Alert>}
      {dialog.includePasswords && <div className="grid gap-2"><label className="text-sm font-medium" htmlFor="export-confirm-password">{t('应用密码确认')}</label><Input id="export-confirm-password" type="password" autoComplete="current-password" value={dialog.confirmPassword} disabled={dialog.pending} onChange={(event) => dialog.setConfirmPassword(event.target.value)} placeholder={t('导出含密码时需验证应用密码')} aria-label={t('应用密码确认')} /><p className="text-xs text-muted-foreground">{t('二次验证可防止已解锁设备被他人直接导出明文密码。')}</p></div>}
      {dialog.error && <p role="alert" className="text-sm text-destructive">{dialog.error}</p>}
    </div><DialogFooter><Button type="button" variant="outline" disabled={dialog.pending} onClick={() => dialog.changeOpen(false)}>{t('取消')}</Button><Button type="button" disabled={dialog.pending || (dialog.includePasswords && dialog.confirmPassword.trim() === '')} onClick={() => { void dialog.runExport() }}>{dialog.pending ? <><Spinner data-icon="inline-start" />{t('导出中...')}</> : <><FileDown data-icon="inline-start" />{t('选择位置并导出')}</>}</Button></DialogFooter>
  </DialogContent></Dialog>
}

interface SegmentedOption { value: string; label: string }

function SegmentedControl(props: { label: string; options: SegmentedOption[]; value: string; disabled?: boolean; onChange: (value: string) => void }) {
  return <div><div className="mb-2 text-xs font-medium text-muted-foreground">{props.label}</div><div role="group" aria-label={props.label} className="flex gap-1 rounded-xl border border-border bg-muted/40 p-1">{props.options.map((option) => <Button key={option.value} type="button" size="sm" className="flex-1" disabled={props.disabled} variant={props.value === option.value ? 'secondary' : 'ghost'} onClick={() => props.onChange(option.value)}>{option.label}</Button>)}</div></div>
}
