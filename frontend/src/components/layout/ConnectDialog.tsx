import { Loader2, CheckCircle, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useConnectDialog } from '@/store/connectDialog'
import { t } from '@/i18n'
import { formatConnectError } from '@/lib/connectError'


export function ConnectDialog() {
  const dialog = useConnectDialog()
  return <Dialog open={dialog.open} onOpenChange={(open) => { if (!open && dialog.state === 'failed') dialog.closeDialog() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{t('SSH 连接')}</DialogTitle></DialogHeader>
        <div className="flex flex-col items-center gap-3 py-6">
          <ConnectStateContent dialog={dialog} />
        </div>
      </DialogContent>
    </Dialog>
}

type ConnectDialogModel = ReturnType<typeof useConnectDialog.getState>

function ConnectStateContent({ dialog }: { dialog: ConnectDialogModel }) {
  if (dialog.state === 'connecting' || dialog.state === 'cancelling') return <ConnectingState dialog={dialog} />
  if (dialog.state === 'connected') return <ConnectedState dialog={dialog} />
  if (dialog.state === 'failed') return <FailedState dialog={dialog} />
  return null
}

function ConnectingState({ dialog }: { dialog: ConnectDialogModel }) {
  return <>
    <div className="relative"><Loader2 className="h-10 w-10 text-blue-500 animate-spin" /><div className="absolute inset-0 flex items-center justify-center"><div className="h-6 w-6 rounded-full bg-blue-500/20" /></div></div>
    <div className="text-sm text-center">
      <p className="font-medium text-foreground">{t('正在连接到')} {dialog.user}@{dialog.host}:{dialog.port}</p>
      <p className="text-xs text-muted-foreground mt-2">{dialog.state === 'cancelling' ? t('正在取消连接...') : t('SSH 握手进行中...')}</p>
    </div>
    <Button variant="outline" size="sm" disabled={dialog.state === 'cancelling'} onClick={() => { void dialog.cancelConnection().catch(() => undefined) }}>{t('取消连接')}</Button>
  </>
}

function ConnectedState({ dialog }: { dialog: ConnectDialogModel }) {
  return <>
    <CheckCircle className="h-10 w-10 text-green-500" />
    <div className="text-sm text-center"><p className="font-medium text-green-600">{t('连接成功')}</p><p className="text-xs text-muted-foreground mt-2">{t('已连接到')} {dialog.user}@{dialog.host}:{dialog.port}</p></div>
  </>
}

function FailedState({ dialog }: { dialog: ConnectDialogModel }) {
  return <>
    <XCircle className="h-10 w-10 text-destructive" />
    <div className="text-sm text-center max-w-xs"><p className="font-medium text-destructive">{t('连接失败')}</p><p className="text-xs text-muted-foreground mt-2 break-all whitespace-pre-wrap">{formatConnectError(dialog.error, t)}</p></div>
    <Button variant="outline" size="sm" className="mt-2" onClick={() => dialog.closeDialog()}>{t('关闭')}</Button>
    {dialog.retry ? <Button size="sm" onClick={() => { dialog.closeDialog(); dialog.retry?.() }}>{t('重试')}</Button> : null}
  </>
}
