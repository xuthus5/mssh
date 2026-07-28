import { useEffect, useRef, useState } from 'react'
import { Download, RotateCcw, Trash2, Upload } from 'lucide-react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useSettingsWindowHide } from '@/hooks/useSettingsWindowHide'
import { t } from '@/i18n'


interface Props {
  pending: string | null
  masterKeySaved: boolean
  onExport: () => void | Promise<void>
  onImport: () => void | Promise<void>
  onReset: () => Promise<void>
}

export function SyncDangerActions(props: Props) {
  const [resetOpen, setResetOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const lifecycle = useRef(0)
  const requestID = useRef(0)
  const active = useRef(false)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => { if (lifecycle.current === token) { lifecycle.current++; requestID.current++; active.current = false } }
  }, [])
  useSettingsWindowHide(() => setResetOpen(false))
  const reset = async () => {
    if (active.current || props.pending !== null) return
    active.current = true
    const lifecycleToken = lifecycle.current
    const request = ++requestID.current
    const isCurrent = () => lifecycle.current === lifecycleToken && requestID.current === request
    setResetting(true)
    try {
      await props.onReset()
      if (isCurrent()) setResetOpen(false)
    } catch { /* error is shown by the controller */ }
    finally {
      if (isCurrent()) {
        active.current = false
        setResetting(false)
      }
    }
  }
  const busy = props.pending !== null || resetting
  return <section className="border-t border-border pt-5"><div className="mb-3"><h4 className="text-sm font-medium">{t('本地备份与重置')}</h4><p className="text-xs text-muted-foreground">{t('导入和重置会关闭活动连接；审计日志、同步记录和应用设置会保留。')}</p></div>
    <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={!props.masterKeySaved || busy} onClick={() => { void Promise.resolve(props.onExport()).catch(() => undefined) }}><Upload data-icon="inline-start" />{t('导出本地备份')}</Button><Button type="button" variant="outline" disabled={!props.masterKeySaved || busy} onClick={() => { void Promise.resolve(props.onImport()).catch(() => undefined) }}><Download data-icon="inline-start" />{t('导入本地备份')}</Button><Button type="button" variant="destructive" disabled={busy} onClick={() => setResetOpen(true)}><Trash2 data-icon="inline-start" />{t('清空本地业务数据')}</Button></div>
    <AlertDialog open={resetOpen} onOpenChange={(open) => { if (!busy) setResetOpen(open) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('清空本地业务数据？')}</AlertDialogTitle><AlertDialogDescription>{t('会清空会话、密钥、隧道、宏与资产归属数据。操作前将创建恢复点，审计日志和同步配置不会删除。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>{t('取消')}</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={busy} onClick={() => { void reset() }}><RotateCcw data-icon="inline-start" />{t('确认清空')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>
}
