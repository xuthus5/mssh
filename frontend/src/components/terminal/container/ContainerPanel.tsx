import { useMemo, useState } from 'react'
import { Boxes, Copy, Play, Plus, RefreshCw, RotateCw, Square, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { t } from '@/i18n'
import type { ContainerEngineInfo, ContainerInfo } from '../../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { ContainerCreateDialog } from './ContainerCreateDialog'
import { useContainerActions, type ContainerAction } from './useContainerActions'
import { useContainers } from './useContainers'

function isContainerRunning(container: ContainerInfo): boolean {
  return container.state === 'running' || container.state === 'paused'
}

export function ContainerPanel({ terminalID, active }: { terminalID: string; active: boolean }) {
  const { overview, failed, refresh } = useContainers(terminalID, active)
  const { busy, runAction, copyRunCommand } = useContainerActions(terminalID, refresh)
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const engines = overview?.engines ?? []
  const filtered = useMemo(() => (overview?.containers ?? []).filter((container) => {
    const search = `${container.name} ${container.id} ${container.image} ${container.engine} ${container.namespace}`.toLowerCase()
    return search.includes(query.trim().toLowerCase())
  }), [overview, query])

  return <div className="space-y-3">
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"><Boxes className="size-4 shrink-0" /><span className="truncate">{t('统一管理当前环境中的容器')}</span></div>
      <div className="flex shrink-0 gap-1">
        <Button size="icon-xs" variant="ghost" aria-label={t('刷新容器')} title={t('刷新容器')} onClick={refresh}><RefreshCw /></Button>
        <Button size="xs" onClick={() => setCreateOpen(true)} disabled={engines.every((engine) => !engine.available)}><Plus />{t('新建容器')}</Button>
      </div>
    </div>
    {engines.length > 0 && <EngineBadges engines={engines} />}
    <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('搜索容器名称、镜像或 ID')} aria-label={t('搜索容器名称、镜像或 ID')} />
    {failed ? <CollectionError onRetry={refresh} /> : !overview ? <p className="text-sm text-muted-foreground">{t('正在采集容器信息...')}</p> : engines.length === 0 ? <p className="rounded-xl border border-border p-3 text-sm text-muted-foreground">{t('没有检测到可用的容器引擎')}</p> : filtered.length === 0 ? <p className="rounded-xl border border-border p-3 text-sm text-muted-foreground">{t('未发现容器')}</p> : <div className="space-y-2">
      {filtered.map((container) => <ContainerCard key={`${container.engine}:${container.namespace}:${container.id}`} container={container} busy={busy} onAction={runAction} onCopy={copyRunCommand} />)}
    </div>}
    <ContainerCreateDialog terminalID={terminalID} engines={engines} open={createOpen} onOpenChange={setCreateOpen} onCreated={refresh} />
  </div>
}

function EngineBadges({ engines }: { engines: ContainerEngineInfo[] }) {
  return <div className="flex flex-wrap gap-1.5">
    {engines.map((engine) => <Badge key={engine.name} variant={engine.available ? 'secondary' : 'outline'} title={engine.error || engine.version}>
      {engine.name}{engine.available ? ` ${engine.version}` : ` · ${t('不可用')}`}
    </Badge>)}
  </div>
}

function ContainerCard({ container, busy, onAction, onCopy }: {
  container: ContainerInfo
  busy: string
  onAction: (container: ContainerInfo, action: ContainerAction) => Promise<void>
  onCopy: (container: ContainerInfo) => Promise<void>
}) {
  const running = isContainerRunning(container)
  return <div className="rounded-xl border border-border bg-background/40 p-3 shadow-sm">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium" title={container.name || container.id}>{container.name || container.id}</span>
          <Badge variant="outline">{container.engine}{container.namespace ? `/${container.namespace}` : ''}</Badge>
          <Badge variant={running ? 'secondary' : 'outline'}>{container.state || t('未知')}</Badge>
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground" title={container.image}>{container.image || t('未知镜像')}</div>
        {container.status && <div className="mt-0.5 truncate text-xs text-muted-foreground" title={container.status}>{container.status}</div>}
        {container.ports && <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground" title={container.ports}>{container.ports}</div>}
      </div>
      <Button size="icon-xs" variant="ghost" aria-label={t('复制运行命令')} title={t('复制运行命令')} disabled={Boolean(busy)} onClick={() => { void onCopy(container) }}><Copy /></Button>
    </div>
    <div className="mt-2 flex justify-end gap-1">
      <ActionButton label={running ? t('停止') : t('启动')} icon={running ? <Square /> : <Play />} disabled={Boolean(busy)} onClick={() => { void onAction(container, running ? 'stop' : 'start') }} />
      <ActionButton label={t('重启')} icon={<RotateCw />} disabled={Boolean(busy)} onClick={() => { void onAction(container, 'restart') }} />
      <Button size="icon-xs" variant="destructive" aria-label={t('删除容器')} title={t('删除容器')} disabled={Boolean(busy)} onClick={() => { void onAction(container, 'remove') }}><Trash2 /></Button>
    </div>
  </div>
}

function ActionButton({ label, icon, disabled, onClick }: { label: string; icon: React.ReactNode; disabled: boolean; onClick: () => void }) {
  return <Button size="xs" variant="outline" aria-label={label} disabled={disabled} onClick={onClick}>{icon}{label}</Button>
}

function CollectionError({ onRetry }: { onRetry: () => void }) {
  return <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
    <span>{t('容器信息采集失败')}</span>
    <Button type="button" size="xs" variant="outline" onClick={onRetry}>{t('重试')}</Button>
  </div>
}
