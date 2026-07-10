import { Loader2, CheckCircle, XCircle, ShieldAlert, Fingerprint } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useConnectDialog } from '@/store/connectDialog'

export function ConnectDialog() {
  const { open, state, host, port, user, error, fingerprint, closeDialog } =
    useConnectDialog()

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) closeDialog() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>SSH 连接</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3 py-6">
          {/* Connecting state */}
          {state === 'connecting' && (
            <>
              <div className="relative">
                <Loader2 className="h-10 w-10 text-blue-500 animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="h-6 w-6 rounded-full bg-blue-500/20" />
                </div>
              </div>
              <div className="text-sm text-center">
                <p className="font-medium text-foreground">
                  正在连接到 {user}@{host}:{port}
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  SSH 握手进行中...
                </p>
              </div>
            </>
          )}

          {/* Fingerprint confirm state */}
          {fingerprint && (
            <>
              <Fingerprint className="h-10 w-10 text-yellow-500" />
              <div className="text-sm text-center">
                <p className="font-medium">主机指纹确认</p>
                <p className="text-xs text-muted-foreground mt-1">
                  首次连接到 {host}:{port}
                </p>
                <div className="mt-3 p-2 bg-muted rounded text-xs font-mono break-all">
                  {fingerprint}
                </div>
              </div>
              <div className="flex gap-2 mt-2">
                <Button variant="outline" size="sm" onClick={closeDialog}>
                  取消
                </Button>
                <Button size="sm" onClick={closeDialog}>
                  信任并连接
                </Button>
              </div>
            </>
          )}

          {/* Connected state */}
          {state === 'connected' && (
            <>
              <CheckCircle className="h-10 w-10 text-green-500" />
              <div className="text-sm text-center">
                <p className="font-medium text-green-600">连接成功</p>
                <p className="text-xs text-muted-foreground mt-2">
                  已连接到 {user}@{host}:{port}
                </p>
              </div>
            </>
          )}

          {/* Failed state */}
          {state === 'failed' && (
            <>
              <XCircle className="h-10 w-10 text-destructive" />
              <div className="text-sm text-center max-w-xs">
                <p className="font-medium text-destructive">连接失败</p>
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
                关闭
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
