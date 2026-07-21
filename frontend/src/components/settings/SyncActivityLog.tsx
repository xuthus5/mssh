import { Activity } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatSyncDate, syncEventStatusLabel } from '@/lib/cloudSyncForm'
import type { SyncEvent } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { t } from '@/i18n'


export function SyncActivityLog({ events }: { events: SyncEvent[] }) {
  return <section className="border-t border-border pt-5"><div className="mb-3 flex items-center gap-2"><Activity className="size-4" /><div><h4 className="text-sm font-medium">{t('同步记录')}</h4><p className="text-xs text-muted-foreground">{t('记录连接测试、上传、下载、冲突和恢复操作。')}</p></div></div>
    <div className="overflow-hidden rounded-xl border border-border">{events.length === 0 ? <div className="px-4 py-8 text-center text-sm text-muted-foreground">{t('尚无同步记录')}</div> : events.slice(0, 50).map((event) => <div key={event.id} className="flex items-start gap-3 border-b border-border px-3 py-2 last:border-b-0"><Badge variant={event.status === 'failed' ? 'destructive' : event.status === 'success' ? 'secondary' : 'outline'}>{syncEventStatusLabel(event.status)}</Badge><div className="min-w-0 flex-1"><div className="text-sm font-medium">{event.message || event.action}</div><div className="mt-1 text-xs text-muted-foreground">{formatSyncDate(event.created_at)} · {event.action}</div></div></div>)}</div>
  </section>
}
