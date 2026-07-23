import { useCallback, useEffect, useMemo, useState } from 'react'
import { CloudCog, Download, Upload } from 'lucide-react'
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
import type { CloudSyncController } from '@/hooks/useCloudSyncCenter'
import { createSyncInput, hasUnsavedSyncChanges, syncStateLabel } from '@/lib/cloudSyncForm'
import type { SyncConfigInput } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { t } from '@/i18n'

interface Props {
  controller: CloudSyncController
  onExport: () => void | Promise<void>
  onImport: () => void | Promise<void>
}

export function SyncPanel({ controller, onExport, onImport }: Props) {
  const [input, setInput] = useState<SyncConfigInput>(() => createSyncInput(controller.dashboard?.config))
  useEffect(() => {
    if (controller.dashboard) setInput(createSyncInput(controller.dashboard.config))
  }, [controller.dashboard])
  const dirty = useMemo(() => hasUnsavedSyncChanges(input, controller.dashboard?.config), [input, controller.dashboard])
  const persist = useCallback(async (next: SyncConfigInput) => {
    await controller.saveConfig(next, { quiet: true })
  }, [controller])
  const autoSave = useAutoSave({
    value: input,
    onSave: persist,
    isReady: Boolean(controller.dashboard),
    delayMs: 500,
  })

  if (controller.loading && !controller.dashboard) return <SyncPanelSkeleton />
  const dashboard = controller.dashboard
  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
            <CloudCog className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">{t('云同步中心')}</h3>
              {dashboard && <Badge variant="outline">{syncStateLabel(dashboard.state)}</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">{t('加密同步会话、密钥、隧道、宏、主题与资产归属数据。')}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <AutoSaveStatusIndicator status={autoSave.status} error={autoSave.error} />
          {!input.enabled && (
            <>
              <Button type="button" size="sm" variant="ghost" disabled={!dashboard?.config.master_key_saved} onClick={() => { void Promise.resolve(onExport()).catch(() => undefined) }}>
                <Upload data-icon="inline-start" />
                {t('导出')}
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={!dashboard?.config.master_key_saved} onClick={() => { void Promise.resolve(onImport()).catch(() => undefined) }}>
                <Download data-icon="inline-start" />
                {t('导入')}
              </Button>
            </>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={input.enabled} onCheckedChange={(enabled) => setInput({ ...input, enabled })} />
            {t('启用云同步')}
          </label>
        </div>
      </div>
      {input.enabled && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('同步设置')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs orientation="horizontal" defaultValue="provider">
              <TabsList className="flex-row">
                <TabsTrigger value="provider">{t('云同步提供商')}</TabsTrigger>
                <TabsTrigger value="status">{t('同步状态与配置')}</TabsTrigger>
              </TabsList>
              <TabsContent value="provider" className="pt-4">
                <SyncProviderTab
                  input={input}
                  saved={dashboard?.config}
                  pending={controller.pending}
                  error={controller.error}
                  onChange={setInput}
                  onTest={() => controller.testProvider(input)}
                />
              </TabsContent>
              {dashboard && (
                <TabsContent value="status" className="pt-4">
                  <SyncStatusTab
                    dashboard={dashboard}
                    input={input}
                    dirty={dirty || autoSave.status === 'pending' || autoSave.status === 'saving'}
                    pending={controller.pending}
                    error={controller.error}
                    onChange={setInput}
                    onSync={controller.syncNow}
                    onPush={controller.pushNow}
                    onPull={controller.pullNow}
                    onResolve={controller.resolveConflict}
                    onRestore={controller.restoreVersion}
                    onDelete={controller.deleteVersion}
                    onReset={controller.resetLocalData}
                    onExport={onExport}
                    onImport={onImport}
                  />
                </TabsContent>
              )}
            </Tabs>
          </CardContent>
        </Card>
      )}
    </div>
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
