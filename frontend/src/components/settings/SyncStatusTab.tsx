import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, RefreshCw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SyncActivityLog } from '@/components/settings/SyncActivityLog'
import { SyncDangerActions } from '@/components/settings/SyncDangerActions'
import { SyncPolicySettings } from '@/components/settings/SyncPolicySettings'
import { SyncVersionHistory } from '@/components/settings/SyncVersionHistory'
import { formatSyncDate, syncProviderLabel, syncStateLabel } from '@/lib/cloudSyncForm'
import { SyncConflictChoice, SyncState, type SyncConfigInput, type SyncDashboard } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { t } from '@/i18n'


interface Props {
  dashboard: SyncDashboard
  input: SyncConfigInput
  dirty: boolean
  pending: string | null
  error: string | null
  onChange: (input: SyncConfigInput) => void
  onSync: () => Promise<void>
  onPush: () => Promise<void>
  onPull: () => Promise<void>
  onResolve: (choice: SyncConflictChoice) => Promise<void>
  onRestore: (id: number) => Promise<void>
  onDelete: (id: number) => Promise<void>
  onReset: () => Promise<void>
  onExport: () => void
  onImport: () => void
}

export function SyncStatusTab(props: Props) {
  const actionsDisabled = props.pending !== null || props.dirty || !props.dashboard.config.master_key_saved
  return <div className="flex flex-col gap-5">
    <SyncOverview dashboard={props.dashboard} />
    {props.dirty && <Alert><AlertTitle>{t('存在未保存配置')}</AlertTitle><AlertDescription>{t('保存 Provider、密钥或同步策略后才能执行同步。')}</AlertDescription></Alert>}
    {props.error && <Alert variant="destructive"><AlertDescription>{props.error}</AlertDescription></Alert>}
    <div className="flex flex-wrap gap-2"><Button type="button" disabled={actionsDisabled} onClick={() => void props.onSync().catch(() => undefined)}><RefreshCw data-icon="inline-start" />{t('立即同步')}</Button><Button type="button" variant="outline" disabled={actionsDisabled} onClick={() => void props.onPush().catch(() => undefined)}><ArrowUpFromLine data-icon="inline-start" />{t('推送本地')}</Button><Button type="button" variant="outline" disabled={actionsDisabled} onClick={() => void props.onPull().catch(() => undefined)}><ArrowDownToLine data-icon="inline-start" />{t('拉取云端')}</Button></div>
    {props.dashboard.conflict && <ConflictPanel pending={props.pending !== null} onResolve={props.onResolve} />}
    <SyncPolicySettings input={props.input} pending={props.pending} onChange={props.onChange} />
    <SyncVersionHistory versions={props.dashboard.versions} pending={props.pending} onRestore={props.onRestore} onDelete={props.onDelete} />
    <SyncActivityLog events={props.dashboard.events} />
    <SyncDangerActions pending={props.pending} masterKeySaved={props.dashboard.config.master_key_saved} onExport={props.onExport} onImport={props.onImport} onReset={props.onReset} />
  </div>
}

function SyncOverview({ dashboard }: { dashboard: SyncDashboard }) {
  const badgeVariant = dashboard.state === SyncState.SyncStateError || dashboard.state === SyncState.SyncStateConflict ? 'destructive' : dashboard.state === SyncState.SyncStateSynced ? 'secondary' : 'outline'
  return <section><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="text-sm font-semibold">{syncProviderLabel(dashboard.config.provider)}</h3><Badge variant={badgeVariant}>{syncStateLabel(dashboard.state)}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{dashboard.message || t('等待同步操作')} {t('· 最近同步')} {formatSyncDate(dashboard.last_synced_at)}</p></div></div>
    <div className="mt-4 grid overflow-hidden rounded-lg border border-border bg-muted/20 md:grid-cols-2 md:divide-x md:divide-border"><VersionSummary title={t('本地版本')} version={dashboard.local_version?.version_number} fingerprint={dashboard.local_version?.snapshot_fingerprint} time={dashboard.local_version?.created_at} /><VersionSummary title={t('云端版本')} version={dashboard.remote_version?.version_number} fingerprint={dashboard.remote_version?.snapshot_fingerprint} time={dashboard.remote_version?.created_at} /></div>
  </section>
}

function VersionSummary(props: { title: string; version?: number; fingerprint?: string; time?: string }) {
  return <div className="px-3 py-3"><div className="text-xs font-medium text-muted-foreground">{props.title}</div><div className="mt-1 text-lg font-semibold">{props.version ? `v${props.version}` : t('未建立')}</div><div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{props.fingerprint ? props.fingerprint.slice(0, 16) : '—'} · {formatSyncDate(props.time)}</div></div>
}

function ConflictPanel({ pending, onResolve }: { pending: boolean; onResolve: (choice: SyncConflictChoice) => Promise<void> }) {
  const resolve = (choice: SyncConflictChoice) => { void onResolve(choice).catch(() => undefined) }
  return <Alert variant="destructive"><AlertTriangle /><AlertTitle>{t('本地与云端都发生了变化')}</AlertTitle><AlertDescription><p className="mb-3">{t('请选择本次冲突的处理方式；取消会保留当前状态。')}</p><div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={pending} onClick={() => resolve(SyncConflictChoice.SyncConflictUseLocal)}>{t('采用本地')}</Button><Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => resolve(SyncConflictChoice.SyncConflictUseCloud)}>{t('采用云端')}</Button><Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => resolve(SyncConflictChoice.SyncConflictCancel)}>{t('暂不处理')}</Button></div></AlertDescription></Alert>
}
