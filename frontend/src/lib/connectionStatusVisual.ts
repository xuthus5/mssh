import type { ConnectionStatus } from '@/store/appStore'

interface ConnectionStatusVisual {
  label: string
  dotClass: string
}

export function connectionStatusVisual(status: ConnectionStatus | undefined): ConnectionStatusVisual {
  switch (status) {
    case 'connected':
      return { label: '已连接', dotClass: 'text-emerald-500 fill-current drop-shadow-[0_0_4px_rgba(16,185,129,0.7)]' }
    case 'connecting':
      return { label: '连接中', dotClass: 'text-amber-500 fill-current motion-safe:animate-pulse' }
    case 'disconnected':
      return { label: '未连接', dotClass: 'text-destructive fill-current' }
    default:
      return { label: '就绪', dotClass: 'text-muted-foreground/50 fill-current' }
  }
}
