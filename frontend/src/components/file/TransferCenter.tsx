import { useEffect, useRef, useState } from 'react'
import { ArrowUpDown, Eraser, Files } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { TransferItem } from '@/components/file/TransferItem'
import { aggregateTransferProgress, partitionTransfers } from '@/lib/transferMetrics'
import { cancelTransfer, retryTransfer } from '@/lib/transferActions'
import { useAppStore, type TransferJob } from '@/store/appStore'
import { restoreTransfers } from '@/store/eventBridge'
import { t } from '@/i18n'


export function TransferCenter() {
  const transfers = useAppStore((state) => state.transfers)
  const loadError = useAppStore((state) => state.transfersLoadError)
  const open = useAppStore((state) => state.transferCenterOpen)
  const setOpen = useAppStore((state) => state.setTransferCenterOpen)
  const removeTransfer = useAppStore((state) => state.removeTransfer)
  const clearFinished = useAppStore((state) => state.clearFinishedTransfers)
  const setTransfersLoadError = useAppStore((state) => state.setTransfersLoadError)
  const actions = useTransferActions(setTransfersLoadError)
  const { active, recent } = partitionTransfers(transfers)
  const summary = aggregateTransferProgress(transfers)
  const triggerLabel = transferTriggerLabel({ activeCount: summary.activeCount, percentage: summary.percentage, loadError, recentCount: recent.length })
  return <>
    <TransferTrigger visible={transfers.length > 0 || Boolean(loadError)} label={triggerLabel} loadError={loadError} summary={summary} recentCount={recent.length} onOpen={() => setOpen(true)} />
    <TransferSheet open={open} setOpen={setOpen} loadError={loadError} actionError={actions.actionError} transfers={transfers} active={active} recent={recent} clearFinished={clearFinished} removeTransfer={removeTransfer} actions={actions} />
  </>
}

function useTransferActions(setTransfersLoadError: (message: string) => void) {
  const [actionError, setActionError] = useState('')
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(() => new Set())
  const lifecycle = useRef(0)
  const actionRequestID = useRef(0)
  const activeKeys = useRef(new Set<string>())
  useEffect(() => {
    const token = ++lifecycle.current
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [])

  const runAction = (key: string, action: () => Promise<unknown>, onError: (error: unknown) => void) => {
    if (activeKeys.current.has(key)) return
    activeKeys.current.add(key)
    const token = ++actionRequestID.current
    const lifecycleToken = lifecycle.current
    setActionError('')
    setPendingKeys((current) => new Set(current).add(key))
    void action().catch((error: unknown) => {
      if (lifecycle.current === lifecycleToken && actionRequestID.current === token) onError(error)
    }).finally(() => {
      activeKeys.current.delete(key)
      if (lifecycle.current !== lifecycleToken) return
      setPendingKeys((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    })
  }

  const transferError = (prefix: string) => (error: unknown) => setActionError(t(prefix, error instanceof Error ? error.message : String(error)))
  const handleCancel = (transfer: TransferJob) => runAction(`transfer:${transfer.id}`, () => cancelTransfer(transfer.id), transferError('取消传输失败: ${}'))
  const handleRetry = (transfer: TransferJob) => runAction(`transfer:${transfer.id}`, () => retryTransfer(transfer), transferError('重试失败: ${}'))
  const reloadTransfers = () => runAction('reload', restoreTransfers, (error) => setTransfersLoadError(error instanceof Error ? error.message : String(error)))
  return { actionError, handleCancel, handleRetry, reloadTransfers,
    reloadPending: pendingKeys.has('reload'), isTransferPending: (id: string) => pendingKeys.has(`transfer:${id}`) }
}

type TransferActions = ReturnType<typeof useTransferActions>
type TransferSummary = ReturnType<typeof aggregateTransferProgress>

function transferTriggerLabel(options: { activeCount: number; percentage: number | null; loadError: string; recentCount: number }) {
  if (options.activeCount > 0) {
    const progress = options.percentage === null ? '' : `，${options.percentage}%`
    return t('打开传输中心，${} 个活动任务${}', options.activeCount, progress)
  }
  return options.loadError ? t('打开传输中心，传输记录加载失败') : t('打开传输中心，${} 条最近记录', options.recentCount)
}

function TransferTrigger({ visible, label, loadError, summary, recentCount, onOpen }: {
  visible: boolean; label: string; loadError: string; summary: TransferSummary; recentCount: number; onOpen: () => void
}) {
  if (!visible) return null
  const badge = loadError ? '!' : summary.activeCount > 0
    ? `${summary.activeCount}${summary.percentage === null ? '' : ` · ${summary.percentage}%`}` : recentCount
  return <Button type="button" size="xs" variant="ghost" aria-label={label} onClick={onOpen}>
      <ArrowUpDown data-icon="inline-start" />
      {t('传输')}
      <Badge variant={loadError ? 'destructive' : 'secondary'}>{badge}</Badge>
    </Button>
}

function TransferSheet(props: {
  open: boolean; setOpen: (open: boolean) => void; loadError: string; actionError: string; transfers: TransferJob[]
  active: TransferJob[]; recent: TransferJob[]; clearFinished: () => void; removeTransfer: (id: string) => void; actions: TransferActions
}) {
  return <Sheet open={props.open} onOpenChange={props.setOpen}>
      <SheetContent className="w-[min(420px,calc(100vw-1rem))] gap-0 sm:max-w-[420px]">
        <SheetHeader className="border-b border-border">
          <div className="flex items-start justify-between gap-3 pr-10">
            <div><SheetTitle>{t('传输中心')}</SheetTitle><SheetDescription>{t('查看当前运行周期的上传与下载任务。')}</SheetDescription></div>
            {props.recent.length > 0 && <Button size="xs" variant="outline" onClick={props.clearFinished}><Eraser data-icon="inline-start" />{t('清除记录')}</Button>}
          </div>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <TransferList {...props} />
        </ScrollArea>
      </SheetContent>
    </Sheet>
}

function TransferList(props: Parameters<typeof TransferSheet>[0]) {
  return <div className="flex flex-col gap-5 p-4">
    {props.loadError ? <Alert variant="destructive"><AlertDescription>
      {t('恢复传输记录失败: ${}', props.loadError)}
      <Button size="xs" variant="outline" className="ml-2" aria-busy={props.actions.reloadPending} disabled={props.actions.reloadPending} onClick={props.actions.reloadTransfers}>{props.actions.reloadPending ? <Spinner data-icon="inline-start" /> : null}{t('重试')}</Button>
    </AlertDescription></Alert> : null}
    {props.actionError ? <Alert variant="destructive"><AlertDescription>{props.actionError}</AlertDescription></Alert> : null}
    {!props.loadError && props.transfers.length === 0 ? <TransferEmpty /> : null}
    <TransferSection title={t('进行中')} transfers={props.active} badgeVariant="secondary" removeTransfer={props.removeTransfer} actions={props.actions} />
    {props.active.length > 0 && props.recent.length > 0 ? <Separator /> : null}
    <TransferSection title={t('最近完成')} transfers={props.recent} badgeVariant="outline" removeTransfer={props.removeTransfer} actions={props.actions} />
  </div>
}

function TransferSection({ title, transfers, badgeVariant, removeTransfer, actions }: {
  title: string; transfers: TransferJob[]; badgeVariant: 'secondary' | 'outline'; removeTransfer: (id: string) => void; actions: TransferActions
}) {
  if (transfers.length === 0) return null
  return <section className="flex flex-col gap-3">
    <div className="flex items-center justify-between"><h3 className="text-sm font-medium text-foreground">{title}</h3><Badge variant={badgeVariant}>{transfers.length}</Badge></div>
    {transfers.map((transfer) => <TransferItem key={transfer.id} transfer={transfer} pending={actions.isTransferPending(transfer.id)} onCancel={actions.handleCancel} onRetry={actions.handleRetry} onRemove={(item) => removeTransfer(item.id)} />)}
  </section>
}

function TransferEmpty() {
  return <Empty className="min-h-72 border"><EmptyHeader><EmptyMedia variant="icon"><Files /></EmptyMedia><EmptyTitle>{t('暂无传输任务')}</EmptyTitle><EmptyDescription>{t('从 SFTP 文件面板开始上传或下载后，任务会显示在这里。')}</EmptyDescription></EmptyHeader></Empty>
}
