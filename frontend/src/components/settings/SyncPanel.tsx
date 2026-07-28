import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { CloudCog, Download, Upload } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AutoSaveStatusIndicator } from '@/components/settings/AutoSaveStatus'
import { SyncProviderTab } from '@/components/settings/SyncProviderTab'
import { SyncStatusTab } from '@/components/settings/SyncStatusTab'
import { useAutoSave } from '@/hooks/useAutoSave'
import { useDraftSync } from '@/hooks/useDraftSync'
import { useSettingsWindowHide } from '@/hooks/useSettingsWindowHide'
import type { CloudSyncController } from '@/hooks/useCloudSyncCenter'
import { createSyncInput, hasUnsavedSyncChanges, syncStateLabel } from '@/lib/cloudSyncForm'
import type { SyncConfig, SyncConfigInput, SyncDashboard } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { t } from '@/i18n'

interface Props {
  controller: CloudSyncController
  onExport: () => void | Promise<void>
  onImport: () => void | Promise<void>
}

type TransferAction = () => void | Promise<void>
type TransferRunner = (action: TransferAction, failure: string) => Promise<void>
type SyncInputSetter = Dispatch<SetStateAction<SyncConfigInput>>
type AutoSaveController = ReturnType<typeof useAutoSave<SyncConfigInput>>

function useSyncTransfer() {
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const lifecycle = useRef(0)
  const requestID = useRef(0)
  const active = useRef(false)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => {
      if (lifecycle.current !== token) return
      lifecycle.current++
      requestID.current++
    }
  }, [])
  const run = useCallback(async (action: TransferAction, failure: string) => {
    if (active.current) return
    active.current = true
    const lifecycleToken = lifecycle.current
    const request = ++requestID.current
    const isCurrent = () => lifecycle.current === lifecycleToken && requestID.current === request
    setPending(true)
    setError('')
    try {
      await action()
    } catch (transferError) {
      if (isCurrent()) setError(t(failure, transferError instanceof Error ? transferError.message : String(transferError)))
    } finally {
      if (isCurrent()) {
        active.current = false
        setPending(false)
      }
    }
  }, [])
  return { error, pending, run }
}

export function SyncPanel({ controller, onExport, onImport }: Props) {
  const { draft: input, setDraft: setInput, acknowledgeSaved, baselineRevision } = useDraftSync({
    source: controller.dashboard?.config,
    createDraft: createSyncDraft,
  })
  const transfer = useSyncTransfer()
  const dirty = useMemo(() => hasUnsavedSyncChanges(input, controller.dashboard?.config), [input, controller.dashboard?.config])
  const persist = useCallback(async (next: SyncConfigInput) => {
    await controller.saveConfig(next, { quiet: true })
    acknowledgeSaved(next, savedSyncDraft(next))
  }, [acknowledgeSaved, controller])
  const autoSave = useAutoSave({
    value: input,
    onSave: persist,
    enabled: controller.pending === null || controller.pending === 'save',
    isReady: Boolean(controller.dashboard),
    delayMs: 500,
    baselineRevision,
  })
  useSettingsWindowHide(useCallback(() => {
    if (!hasTransientSyncSecrets(input)) return
    const redacted = savedSyncDraft(input)
    autoSave.redact(input, redacted)
    setInput(redacted)
  }, [autoSave.redact, input, setInput]))
  if (controller.loading && !controller.dashboard) return <SyncPanelSkeleton />
  return (
    <SyncPanelContent
      controller={controller} input={input} setInput={setInput} dirty={dirty} autoSave={autoSave}
      transfer={transfer} onExport={onExport} onImport={onImport}
    />
  )
}

interface SyncPanelContentProps extends Props {
  input: SyncConfigInput
  setInput: SyncInputSetter
  dirty: boolean
  autoSave: AutoSaveController
  transfer: ReturnType<typeof useSyncTransfer>
}

function SyncPanelContent(props: SyncPanelContentProps) {
  const dashboard = props.controller.dashboard
  const pending = props.controller.pending ?? (props.transfer.pending ? 'transfer' : null)
  return (
    <div className="flex flex-col gap-4 pt-2">
      <SyncPanelHeader {...props} dashboard={dashboard} />
      <SyncLoadError controller={props.controller} dashboard={dashboard} />
      {props.transfer.error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {props.transfer.error}
        </div>
      ) : null}
      {props.input.enabled && <SyncSettingsCard {...props} dashboard={dashboard} pending={pending} />}
    </div>
  )
}

interface SyncPanelViewProps extends SyncPanelContentProps {
  dashboard: SyncDashboard | null
}

function SyncPanelHeader(props: SyncPanelViewProps) {
  const runTransfer = props.transfer.run
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary"><CloudCog className="size-5" /></div>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{t('云同步中心')}</h3>
            {props.dashboard && <Badge variant="outline">{syncStateLabel(props.dashboard.state)}</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">{t('加密同步会话、密钥、隧道、宏、主题与资产归属数据。')}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <AutoSaveStatusIndicator status={props.autoSave.status} error={props.autoSave.error} />
        {!props.input.enabled && <SyncTransferButtons {...props} runTransfer={runTransfer} />}
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={props.input.enabled} onCheckedChange={(enabled) => props.setInput({ ...props.input, enabled })} />
          {t('启用云同步')}
        </label>
      </div>
    </div>
  )
}

interface SyncTransferButtonsProps extends SyncPanelViewProps {
  runTransfer: TransferRunner
}

function SyncTransferButtons(props: SyncTransferButtonsProps) {
  const disabled = !props.dashboard?.config.master_key_saved || props.transfer.pending
  return (
    <>
      <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => { void props.runTransfer(props.onExport, '导出本地备份失败: ${}') }}>
        <Upload data-icon="inline-start" />
        {t('导出')}
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => { void props.runTransfer(props.onImport, '导入本地备份失败: ${}') }}>
        <Download data-icon="inline-start" />
        {t('导入')}
      </Button>
    </>
  )
}

function SyncLoadError({ controller, dashboard }: Pick<SyncPanelViewProps, 'controller' | 'dashboard'>) {
  if (!controller.error || dashboard) return null
  return (
    <Alert variant="destructive" className="items-center justify-between gap-3 sm:flex">
      <AlertDescription>{controller.error}</AlertDescription>
      <Button type="button" size="xs" variant="outline" disabled={controller.loading} onClick={() => { void controller.reload() }}>{t('重试')}</Button>
    </Alert>
  )
}

interface SyncSettingsCardProps extends SyncPanelViewProps {
  pending: string | null
}

function SyncSettingsCard(props: SyncSettingsCardProps) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">{t('同步设置')}</CardTitle></CardHeader>
      <CardContent>
        <Tabs orientation="horizontal" defaultValue="provider">
          <TabsList className="flex-row">
            <TabsTrigger value="provider">{t('云同步提供商')}</TabsTrigger>
            <TabsTrigger value="status">{t('同步状态与配置')}</TabsTrigger>
          </TabsList>
          <SyncProviderContent {...props} />
          {props.dashboard && <SyncStatusContent {...props} dashboard={props.dashboard} />}
        </Tabs>
      </CardContent>
    </Card>
  )
}

function SyncProviderContent(props: SyncSettingsCardProps) {
  return (
    <TabsContent value="provider" className="pt-4">
      <SyncProviderTab
        input={props.input} saved={props.dashboard?.config} pending={props.pending} error={props.controller.error}
        onChange={props.setInput} onTest={() => props.controller.testProvider(props.input)}
      />
    </TabsContent>
  )
}

function SyncStatusContent(props: SyncSettingsCardProps & { dashboard: SyncDashboard }) {
  const runTransfer = props.transfer.run
  return (
    <TabsContent value="status" className="pt-4">
      <SyncStatusTab
        dashboard={props.dashboard} input={props.input}
        dirty={props.dirty || props.autoSave.status === 'pending' || props.autoSave.status === 'saving'}
        pending={props.pending} error={props.controller.error} onChange={props.setInput}
        onSync={props.controller.syncNow} onPush={props.controller.pushNow} onPull={props.controller.pullNow}
        onResolve={props.controller.resolveConflict} onRestore={props.controller.restoreVersion}
        onDelete={props.controller.deleteVersion} onReset={props.controller.resetLocalData}
        onExport={() => runTransfer(props.onExport, '导出本地备份失败: ${}')}
        onImport={() => runTransfer(props.onImport, '导入本地备份失败: ${}')}
      />
    </TabsContent>
  )
}

function SyncPanelSkeleton() {
  return (
    <div className="flex flex-col gap-3 pt-2">
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="h-72 w-full rounded-xl" />
    </div>
  )
}

function createSyncDraft(config: SyncConfig | undefined): SyncConfigInput {
  return createSyncInput(config)
}

function savedSyncDraft(input: SyncConfigInput): SyncConfigInput {
  return {
    ...input,
    master_key: '',
    gist: { ...input.gist, token: '', clear_token: false },
    webdav: { ...input.webdav, password: '', clear_password: false },
    s3: { ...input.s3, secret_key: '', clear_secret_key: false },
  }
}

function hasTransientSyncSecrets(input: SyncConfigInput) {
  return input.master_key !== '' || input.gist.token !== '' || input.gist.clear_token
    || input.webdav.password !== '' || input.webdav.clear_password
    || input.s3.secret_key !== '' || input.s3.clear_secret_key
}
