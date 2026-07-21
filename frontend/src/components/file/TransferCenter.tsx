import { ArrowUpDown, Eraser, Files } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { TransferItem } from '@/components/file/TransferItem'
import { aggregateTransferProgress, partitionTransfers } from '@/lib/transferMetrics'
import { cancelTransfer, retryTransfer } from '@/lib/transferActions'
import { useAppStore, type TransferJob } from '@/store/appStore'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'


export function TransferCenter() {
  const transfers = useAppStore((state) => state.transfers)
  const open = useAppStore((state) => state.transferCenterOpen)
  const setOpen = useAppStore((state) => state.setTransferCenterOpen)
  const removeTransfer = useAppStore((state) => state.removeTransfer)
  const clearFinished = useAppStore((state) => state.clearFinishedTransfers)
  const { active, recent } = partitionTransfers(transfers)
  const summary = aggregateTransferProgress(transfers)

  const handleCancel = (transfer: TransferJob) => {
    void cancelTransfer(transfer.id).catch((error: unknown) => toast(t('取消传输失败: ${}', error instanceof Error ? error.message : String(error)), 'error'))
  }

  const handleRetry = (transfer: TransferJob) => {
    void retryTransfer(transfer).catch((error: unknown) => toast(t('重试失败: ${}', error instanceof Error ? error.message : String(error)), 'error'))
  }

  const triggerLabel = summary.activeCount > 0
    ? t('打开传输中心，${} 个活动任务${}', summary.activeCount, summary.percentage === null ? '' : `，${summary.percentage}%`)
    : t('打开传输中心，${} 条最近记录', recent.length)

  return <>
    {transfers.length > 0 && <Button type="button" size="xs" variant="ghost" aria-label={triggerLabel} onClick={() => setOpen(true)}>
      <ArrowUpDown data-icon="inline-start" />
      {t('传输')}
      <Badge variant="secondary">{summary.activeCount > 0 ? `${summary.activeCount}${summary.percentage === null ? '' : ` · ${summary.percentage}%`}` : recent.length}</Badge>
    </Button>}
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent className="w-[min(420px,calc(100vw-1rem))] gap-0 sm:max-w-[420px]">
        <SheetHeader className="border-b border-border">
          <div className="flex items-start justify-between gap-3 pr-10">
            <div><SheetTitle>{t('传输中心')}</SheetTitle><SheetDescription>{t('查看当前运行周期的上传与下载任务。')}</SheetDescription></div>
            {recent.length > 0 && <Button size="xs" variant="outline" onClick={clearFinished}><Eraser data-icon="inline-start" />{t('清除记录')}</Button>}
          </div>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-5 p-4">
            {transfers.length === 0 && <Empty className="min-h-72 border"><EmptyHeader><EmptyMedia variant="icon"><Files /></EmptyMedia><EmptyTitle>{t('暂无传输任务')}</EmptyTitle><EmptyDescription>{t('从 SFTP 文件面板开始上传或下载后，任务会显示在这里。')}</EmptyDescription></EmptyHeader></Empty>}
            {active.length > 0 && <section className="flex flex-col gap-3"><div className="flex items-center justify-between"><h3 className="text-sm font-medium text-foreground">{t('进行中')}</h3><Badge variant="secondary">{active.length}</Badge></div>{active.map((transfer) => <TransferItem key={transfer.id} transfer={transfer} onCancel={handleCancel} onRetry={handleRetry} onRemove={(item) => removeTransfer(item.id)} />)}</section>}
            {active.length > 0 && recent.length > 0 && <Separator />}
            {recent.length > 0 && <section className="flex flex-col gap-3"><div className="flex items-center justify-between"><h3 className="text-sm font-medium text-foreground">{t('最近完成')}</h3><Badge variant="outline">{recent.length}</Badge></div>{recent.map((transfer) => <TransferItem key={transfer.id} transfer={transfer} onCancel={handleCancel} onRetry={handleRetry} onRemove={(item) => removeTransfer(item.id)} />)}</section>}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  </>
}
