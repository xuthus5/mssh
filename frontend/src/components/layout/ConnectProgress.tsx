import { Check, Fingerprint, Network, PlugZap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'
import type { ConnectStage, ConnectState } from '@/store/connectDialog'

interface ConnectProgressProps {
  state: ConnectState | 'fingerprint'
  hasJumpHost?: boolean
  stage?: ConnectStage
}

export function ConnectProgress({ state, hasJumpHost = false, stage = 'target' }: ConnectProgressProps) {
  const steps = [
    ...(hasJumpHost ? [{ label: t('SSH 连接隧道'), icon: Network }] : []),
    { label: t('建立连接'), icon: PlugZap },
    { label: t('指纹确认'), icon: Fingerprint },
    { label: t('连接成功'), icon: Check },
  ]
  const current = state === 'connected' ? steps.length - 1 : hasJumpHost && stage === 'jump' ? 0
    : Number(hasJumpHost) + Number(state === 'fingerprint')
  return (
    <ol aria-label={t('连接进度')} className="flex items-start gap-2 border-b border-border pb-5">
      {steps.map(({ label, icon: Icon }, index) => (
        <li key={label} aria-current={current === index ? 'step' : undefined} className="relative flex flex-1 flex-col items-center gap-2 text-center">
          {index > 0 ? <span aria-hidden="true" className="absolute right-1/2 top-4 h-px w-full bg-border" /> : null}
          <span className={cn('relative z-10 flex size-8 items-center justify-center rounded-full border border-border bg-background text-muted-foreground',
            index <= current && 'border-primary bg-primary text-primary-foreground',
            state === 'failed' && index === current && 'border-destructive bg-background text-destructive')}>
            {index < current ? <Check aria-hidden="true" className="size-4" /> : <Icon aria-hidden="true" className="size-4" />}
          </span>
          <span className={cn('text-xs text-muted-foreground', index <= current && 'font-medium text-foreground')}>{label}</span>
        </li>
      ))}
    </ol>
  )
}
