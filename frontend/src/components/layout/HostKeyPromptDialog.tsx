import { Fingerprint } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { t } from '@/i18n'
import { useHostKeyPromptDialog } from '@/store/hostKeyPromptDialog'

export function HostKeyPromptDialog() {
  const { active, pending, error, decide, dismiss } = useHostKeyPromptDialog()
  if (!active) return null
  const { prompt, endpoint } = active

  return (
    <AlertDialog
      open
      onOpenChange={(open) => { if (!open && !pending) void dismiss() }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia><Fingerprint /></AlertDialogMedia>
          <AlertDialogTitle>{t('主机指纹确认')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('首次连接到 ${}:${}。', endpoint.host, endpoint.port)}{t('请在信任前核对远端服务器展示的指纹。')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/50 p-3">
          <code className="break-all font-mono text-xs text-foreground">{prompt.fingerprint}</code>
          {prompt.algorithm ? <Badge variant="secondary">{prompt.algorithm}</Badge> : null}
        </div>
        {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
        <AlertDialogFooter>
          {error ? <Button type="button" variant="ghost" disabled={pending} onClick={() => { void dismiss() }}>{t('关闭')}</Button> : null}
          <AlertDialogAction type="button" variant="outline" disabled={pending} onClick={() => { void decide(false) }}>
            {t('拒绝')}
          </AlertDialogAction>
          <AlertDialogAction type="button" disabled={pending} onClick={() => { void decide(true) }}>
            {pending ? <><Spinner data-icon="inline-start" />{t('处理中...')}</> : t('信任并连接')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
