import { useState } from 'react'
import { Download, RotateCcw, Trash2, Upload } from 'lucide-react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

interface Props {
  pending: string | null
  masterKeySaved: boolean
  onExport: () => void
  onImport: () => void
  onReset: () => Promise<void>
}

export function SyncDangerActions(props: Props) {
  const [resetOpen, setResetOpen] = useState(false)
  const reset = async () => {
    try { await props.onReset(); setResetOpen(false) } catch { /* error is shown by the controller */ }
  }
  return <section className="border-t border-border pt-5"><div className="mb-3"><h4 className="text-sm font-medium">本地备份与重置</h4><p className="text-xs text-muted-foreground">导入和重置会关闭活动连接；审计日志、同步记录和应用设置会保留。</p></div>
    <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={!props.masterKeySaved || props.pending !== null} onClick={props.onExport}><Upload data-icon="inline-start" />导出本地备份</Button><Button type="button" variant="outline" disabled={!props.masterKeySaved || props.pending !== null} onClick={props.onImport}><Download data-icon="inline-start" />导入本地备份</Button><Button type="button" variant="destructive" disabled={props.pending !== null} onClick={() => setResetOpen(true)}><Trash2 data-icon="inline-start" />清空本地业务数据</Button></div>
    <AlertDialog open={resetOpen} onOpenChange={(open) => { if (props.pending === null) setResetOpen(open) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>清空本地业务数据？</AlertDialogTitle><AlertDialogDescription>会清空会话、密钥、隧道、宏与资产归属数据。操作前将创建恢复点，审计日志和同步配置不会删除。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={props.pending !== null}>取消</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={props.pending !== null} onClick={() => { void reset() }}><RotateCcw data-icon="inline-start" />确认清空</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>
}
