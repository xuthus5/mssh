import type { ReactNode } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

interface Props {
  pending: boolean
  error?: string
  empty?: boolean
  emptyText?: string
  onRetry?: () => void
  children: ReactNode
}

export function AsyncState({ pending, error, empty, emptyText = '暂无数据', onRetry, children }: Props) {
  if (pending) return <div aria-label="加载中" className="flex flex-col gap-2"><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-4/5" /><Skeleton className="h-9 w-3/5" /></div>
  if (error) return <Alert variant="destructive"><AlertDescription>{error}{onRetry && <Button size="xs" variant="outline" className="ml-3" onClick={onRetry}>重试</Button>}</AlertDescription></Alert>
  if (empty) return <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{emptyText}</div>
  return children
}
