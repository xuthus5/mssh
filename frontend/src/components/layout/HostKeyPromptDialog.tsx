import { useEffect, useRef } from 'react'
import { Fingerprint, ShieldAlert } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { DialogFooter } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { t } from '@/i18n'
import { useHostKeyPromptDialog } from '@/store/hostKeyPromptDialog'

export function HostKeyPromptContent() {
  const { active, pending, error, decide, dismiss } = useHostKeyPromptDialog()
  const rejectButton = useRef<HTMLButtonElement>(null)
  useEffect(() => { rejectButton.current?.focus() }, [active?.prompt.attemptId])
  if (!active) return null
  const { prompt, endpoint } = active

  return (
    <>
        <div className="flex flex-col gap-2" aria-live="polite">
          <div className="flex items-center gap-2">
            {prompt.changed ? <ShieldAlert aria-hidden="true" className="size-5 text-destructive" /> : <Fingerprint aria-hidden="true" className="size-5 text-primary" />}
            <h3 className="font-medium">{prompt.changed ? t('主机指纹已变化') : t('主机指纹确认')}</h3>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {prompt.changed
              ? t('连接到 ${}:${} 时，远端主机指纹与已信任记录不一致。', endpoint.host, endpoint.port)
              : t('首次连接到 ${}:${}。', endpoint.host, endpoint.port)}{' '}
            {t('请在信任前核对远端服务器展示的指纹。')}
          </p>
        </div>
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/50 p-3">
          {prompt.changed && prompt.expected.length > 0 ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{t('已信任指纹')}</span>
              {prompt.expected.map((fingerprint) => <code key={fingerprint} className="break-all font-mono text-xs text-muted-foreground line-through">{fingerprint}</code>)}
            </div>
          ) : null}
          {prompt.changed ? <span className="text-xs text-muted-foreground">{t('当前指纹')}</span> : null}
          <code className="break-all font-mono text-xs text-foreground">{prompt.fingerprint}</code>
          {prompt.algorithm ? <Badge variant="secondary">{prompt.algorithm}</Badge> : null}
        </div>
        {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
        <DialogFooter>
          {error ? <Button type="button" variant="ghost" disabled={pending} onClick={() => { void dismiss() }}>{t('关闭')}</Button> : null}
          <Button ref={rejectButton} type="button" variant="outline" disabled={pending} onClick={() => { void decide(false) }}>
            {t('拒绝')}
          </Button>
          <Button type="button" disabled={pending} onClick={() => { void decide(true) }}>
            {pending ? <><Spinner data-icon="inline-start" />{t('处理中...')}</> : prompt.changed ? t('信任新指纹并连接') : t('信任并连接')}
          </Button>
        </DialogFooter>
    </>
  )
}
