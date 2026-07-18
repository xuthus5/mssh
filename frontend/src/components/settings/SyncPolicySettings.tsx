import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SyncStrategy, type SyncConfigInput } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

interface Props {
  input: SyncConfigInput
  pending: string | null
  onChange: (input: SyncConfigInput) => void
  onSave: () => Promise<void>
}

export function SyncPolicySettings(props: Props) {
  const update = (patch: Partial<SyncConfigInput>) => props.onChange({ ...props.input, ...patch })
  return <section className="border-t border-border pt-5"><div className="mb-3"><h4 className="text-sm font-medium">同步策略与保留</h4><p className="text-xs text-muted-foreground">自动同步在应用启动后执行，并按设置的间隔持续运行。</p></div>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">同步策略</span><Select value={props.input.strategy} onValueChange={(strategy) => update({ strategy: strategy as SyncStrategy })}><SelectTrigger aria-label="同步策略" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={SyncStrategy.SyncStrategySmart}>智能同步</SelectItem><SelectItem value={SyncStrategy.SyncStrategyCloudFirst}>云端优先</SelectItem><SelectItem value={SyncStrategy.SyncStrategyLocalFirst}>本地优先</SelectItem></SelectContent></Select></label>
      <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">自动同步</span><Select value={String(props.input.interval_minutes)} onValueChange={(value) => update({ interval_minutes: Number(value) })}><SelectTrigger aria-label="自动同步间隔" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0">仅手动</SelectItem><SelectItem value="5">每 5 分钟</SelectItem><SelectItem value="15">每 15 分钟</SelectItem><SelectItem value="30">每 30 分钟</SelectItem><SelectItem value="60">每 60 分钟</SelectItem></SelectContent></Select></label>
      <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">保留版本数</span><Input aria-label="保留版本数" type="number" min={1} max={500} value={props.input.retention_count} onChange={(event) => update({ retention_count: Number(event.target.value) })} /></label>
      <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">保留天数</span><Input aria-label="保留天数" type="number" min={1} max={3650} value={props.input.retention_days} onChange={(event) => update({ retention_days: Number(event.target.value) })} /></label>
    </div>
    <div className="mt-3 flex justify-end"><Button type="button" variant="outline" disabled={props.pending !== null} onClick={() => void props.onSave().catch(() => undefined)}><Save data-icon="inline-start" />保存策略</Button></div>
  </section>
}
