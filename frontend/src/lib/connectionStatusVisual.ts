import type { ConnectionStatus } from '@/store/appStore'
import { t } from '@/i18n'


interface ConnectionStatusVisual {
  label: string
  dotClass: string
}

export function connectionStatusVisual(status: ConnectionStatus | undefined): ConnectionStatusVisual {
  switch (status) {
    case 'connected':
      return { label: t('已连接'), dotClass: 'text-emerald-500 fill-current drop-shadow-[0_0_4px_rgba(16,185,129,0.7)]' }
    case 'connecting':
      return { label: t('连接中'), dotClass: 'text-amber-500 fill-current motion-safe:animate-pulse' }
    case 'reconnecting':
      return { label: t('重连中'), dotClass: 'text-sky-500 fill-current motion-safe:animate-pulse' }
    case 'closing':
      return { label: t('关闭中'), dotClass: 'text-amber-500 fill-current motion-safe:animate-pulse' }
    case 'error':
      return { label: t('连接错误'), dotClass: 'text-destructive fill-current' }
    case 'disconnected':
      return { label: t('未连接'), dotClass: 'text-destructive fill-current' }
    default:
      return { label: t('就绪'), dotClass: 'text-muted-foreground/50 fill-current' }
  }
}
