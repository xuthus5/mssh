import { Loader2, CheckCircle, XCircle, ShieldAlert, Fingerprint } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useConnectDialog } from '@/store/connectDialog'
import { t } from '@/i18n'


export function ConnectDialog() {
  const { open, state, host, port, user, error, fingerprint, algorithm, retry, closeDialog, acceptHostKey, rejectHostKey, cancelConnection } =
    useConnectDialog()

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && state === 'failed') closeDialog() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('SSH 连接')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3 py-6">
          {/* Connecting state */}
          {(state === 'connecting' || state === 'cancelling') && (
            <>
              <div className="relative">
                <Loader2 className="h-10 w-10 text-blue-500 animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="h-6 w-6 rounded-full bg-blue-500/20" />
                </div>
              </div>
              <div className="text-sm text-center">
                <p className="font-medium text-foreground">
                  {t('正在连接到')} {user}@{host}:{port}
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  {state === 'cancelling' ? t('正在取消连接...') : t('SSH 握手进行中...')}
                </p>
              </div>
              <Button variant="outline" size="sm" disabled={state === 'cancelling'} onClick={() => { void cancelConnection() }}>
                {t('取消连接')}
              </Button>
            </>
          )}

          {/* Fingerprint confirm state */}
          {state === 'awaiting-host-key' && fingerprint && (
            <>
              <Fingerprint className="h-10 w-10 text-yellow-500" />
              <div className="text-sm text-center">
                <p className="font-medium">{t('主机指纹确认')}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('首次连接到')} {host}:{port}
                </p>
                <div className="mt-3 p-2 bg-muted rounded text-xs font-mono break-all">
                  {fingerprint}
                </div>
                {algorithm && <p className="mt-2 text-xs text-muted-foreground">{t('算法：')}{algorithm}</p>}
              </div>
              <div className="flex gap-2 mt-2">
                <Button variant="outline" size="sm" onClick={() => { void rejectHostKey() }}>
                  {t('拒绝')}
                </Button>
                <Button size="sm" onClick={() => { void acceptHostKey() }}>
                  {t('信任并连接')}
                </Button>
              </div>
            </>
          )}

          {/* Connected state */}
          {state === 'connected' && (
            <>
              <CheckCircle className="h-10 w-10 text-green-500" />
              <div className="text-sm text-center">
                <p className="font-medium text-green-600">{t('连接成功')}</p>
                <p className="text-xs text-muted-foreground mt-2">
                  {t('已连接到')} {user}@{host}:{port}
                </p>
              </div>
            </>
          )}

          {/* Failed state */}
          {state === 'failed' && (
            <>
              <XCircle className="h-10 w-10 text-destructive" />
              <div className="text-sm text-center max-w-xs">
                <p className="font-medium text-destructive">{t('连接失败')}</p>
                <p className="text-xs text-muted-foreground mt-2 break-all">
                  {error}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={closeDialog}
              >
                {t('关闭')}
              </Button>
              {retry && (
                <Button size="sm" onClick={() => { closeDialog(); retry() }}>
                  {t('重试')}
                </Button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
