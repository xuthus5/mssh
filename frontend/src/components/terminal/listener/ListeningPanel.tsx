import { useMemo, useState } from 'react'
import { Radio, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { t } from '@/i18n'
import type { ListeningPortInfo } from '../../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { useListeningPorts } from './useListeningPorts'

export function ListeningPanel({ terminalID, active }: { terminalID: string; active: boolean }) {
  const { ports, failed, refresh } = useListeningPorts(terminalID, active)
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => (ports ?? []).filter((port) => {
    const search = `${port.protocol} ${port.address} ${port.port} ${port.pid} ${port.process_name}`.toLowerCase()
    return search.includes(query.trim().toLowerCase())
  }), [ports, query])

  return <div className="space-y-3">
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"><Radio className="size-4 shrink-0" /><span className="truncate">{t('查看当前环境中的监听端口')}</span></div>
      <Button size="icon-xs" variant="ghost" aria-label={t('刷新监听端口')} title={t('刷新监听端口')} onClick={refresh}><RefreshCw /></Button>
    </div>
    <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('搜索端口、地址、PID 或进程')} aria-label={t('搜索端口、地址、PID 或进程')} />
    {failed ? <CollectionError onRetry={refresh} /> : !ports ? <p className="text-sm text-muted-foreground">{t('正在采集监听端口...')}</p> : filtered.length === 0 ? <p className="rounded-xl border border-border p-3 text-sm text-muted-foreground">{t('未发现监听端口')}</p> : <ListeningTable ports={filtered} />}
  </div>
}

function ListeningTable({ ports }: { ports: ListeningPortInfo[] }) {
  return <div data-testid="listening-table" className="overflow-hidden rounded-xl border border-border shadow-sm">
    <div className="grid grid-cols-[48px_minmax(0,1fr)_52px_52px_minmax(0,1fr)] gap-2 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <span>{t('协议')}</span><span>{t('监听地址')}</span><span>{t('端口')}</span><span>PID</span><span>{t('进程名称')}</span>
    </div>
    {ports.map((port, index) => <div key={`${port.protocol}:${port.address}:${port.port}:${port.pid}:${index}`} className="grid grid-cols-[48px_minmax(0,1fr)_52px_52px_minmax(0,1fr)] gap-2 border-t border-border px-3 py-2 text-xs">
      <span className="uppercase">{port.protocol}</span>
      <span className="truncate font-mono" title={port.address}>{port.address}</span>
      <span className="tabular-nums">{port.port}</span>
      <span className="tabular-nums">{port.pid || '-'}</span>
      <span className="truncate" title={port.process_name}>{port.process_name || t('未知')}</span>
    </div>)}
  </div>
}

function CollectionError({ onRetry }: { onRetry: () => void }) {
  return <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
    <span>{t('监听端口采集失败')}</span>
    <Button type="button" size="xs" variant="outline" onClick={onRetry}>{t('重试')}</Button>
  </div>
}
