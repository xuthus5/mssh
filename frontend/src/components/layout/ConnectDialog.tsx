import { Loader2, CheckCircle, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ConnectProgress } from '@/components/layout/ConnectProgress'
import { HostKeyPromptContent } from '@/components/layout/HostKeyPromptDialog'
import { useConnectDialogLifecycle } from '@/components/layout/connectDialogLifecycle'
import { useConnectDialog } from '@/store/connectDialog'
import { useHostKeyPromptDialog } from '@/store/hostKeyPromptDialog'
import { t } from '@/i18n'
import { formatConnectError } from '@/lib/connectError'
import { logger } from '@/lib/logger'

export function ConnectDialog() {
  const dialog = useConnectDialog()
  const prompt = useHostKeyPromptDialog()
  const lifecycle = useConnectDialogLifecycle(dialog, Boolean(prompt.active))
  const target = prompt.active
    ? formatEndpoint(prompt.active.endpoint.host, prompt.active.endpoint.port)
    : `${dialog.user}@${formatEndpoint(dialog.host, dialog.port)}`
  const close = () => {
    if (prompt.active) { if (!prompt.pending) void prompt.dismiss(); return }
    if (dialog.state === 'connected') lifecycle.finish()
    if (dialog.state === 'failed') dialog.closeDialog()
  }
  return <Dialog open={dialog.open || Boolean(prompt.active)} onOpenChange={(open) => { if (!open) close() }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto border border-border bg-background text-foreground shadow-sm sm:max-w-md" showCloseButton={false} finalFocus={lifecycle.finalFocus}>
        <DialogHeader>
          <DialogTitle>{t('SSH 连接')}</DialogTitle>
          <DialogDescription className="break-all font-mono text-xs">{target}</DialogDescription>
        </DialogHeader>
        <ConnectProgress state={prompt.active ? 'fingerprint' : dialog.state} />
        {prompt.active ? <HostKeyPromptContent /> : <ConnectStateContent dialog={dialog} finish={lifecycle.finish} />}
      </DialogContent>
    </Dialog>
}

type ConnectDialogModel = ReturnType<typeof useConnectDialog.getState>

function ConnectStateContent({ dialog, finish }: { dialog: ConnectDialogModel; finish: () => void }) {
  if (dialog.state === 'connecting' || dialog.state === 'cancelling') return <ConnectingState dialog={dialog} />
  if (dialog.state === 'connected') return <ConnectedState finish={finish} />
  if (dialog.state === 'failed') return <FailedState dialog={dialog} />
  return null
}

function ConnectingState({ dialog }: { dialog: ConnectDialogModel }) {
  return <>
    <div role="status" className="flex flex-col items-center gap-3 py-6 text-center">
      <Loader2 aria-hidden="true" className="size-9 animate-spin text-primary motion-reduce:animate-none" />
      <p className="text-sm text-muted-foreground">{dialog.state === 'cancelling' ? t('正在取消连接...') : t('SSH 握手进行中...')}</p>
    </div>
    <DialogFooter>
      <Button variant="outline" disabled={dialog.state === 'cancelling'} onClick={() => { void dialog.cancelConnection().catch((error: unknown) => logger.error('cancel connection failed', error)) }}>{t('取消连接')}</Button>
    </DialogFooter>
  </>
}

function ConnectedState({ finish }: { finish: () => void }) {
  return <>
    <div role="status" className="flex flex-col items-center gap-3 py-6 text-center">
      <CheckCircle aria-hidden="true" className="size-9 text-primary" />
      <h3 className="font-medium text-foreground">{t('连接成功')}</h3>
      <p className="text-xs text-muted-foreground">{t('正在进入终端...')}</p>
    </div>
    <DialogFooter><Button onClick={finish}>{t('进入终端')}</Button></DialogFooter>
  </>
}

function FailedState({ dialog }: { dialog: ConnectDialogModel }) {
  return <>
    <div role="alert" className="flex flex-col items-center gap-3 py-6 text-center">
      <XCircle aria-hidden="true" className="size-9 text-destructive" />
      <h3 className="font-medium text-destructive">{t('连接失败')}</h3>
      <p className="max-w-full break-all whitespace-pre-wrap text-xs text-muted-foreground">{formatConnectError(dialog.error, t)}</p>
    </div>
    <DialogFooter>
      <Button variant="outline" onClick={() => dialog.closeDialog()}>{t('关闭')}</Button>
      {dialog.retry ? <Button onClick={() => { dialog.closeDialog(); dialog.retry?.() }}>{t('重试')}</Button> : null}
    </DialogFooter>
  </>
}

function formatEndpoint(host: string, port: number) {
  return `${host.includes(':') ? `[${host}]` : host}:${port}`
}
