import { Cable, Play, SquareTerminal, Trash2 } from 'lucide-react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { BatchSessionResult } from '@/lib/sessionBatch'
import { t } from '@/i18n'
import { useSessionBatchActions, type PendingAction, type SessionBatchOptions } from '@/components/session/useSessionBatchActions'

export function SessionBatchActions(props: SessionBatchOptions) {
  const controller = useSessionBatchActions(props)
  const pendingAction = controller.target?.action ?? null
  const pendingCount = controller.target?.sessionIDs.length ?? 0

  return <>
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-sm">
      <Badge variant="secondary">{t('已选')} {props.selectedIDs.length} {t('项')}</Badge>
      <Button size="sm" variant="outline" disabled={props.selectedIDs.length === 0 || controller.executing} onClick={() => controller.openAction({ type: 'connect' })}><Cable />{t('批量连接')}</Button>
      <DropdownMenu><DropdownMenuTrigger render={<Button size="sm" variant="outline" disabled={props.selectedIDs.length === 0 || controller.macros.length === 0 || controller.executing} title={controller.macroError || undefined} />}><Play />{t('执行宏')}</DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuGroup>{controller.macros.map((macro) => <DropdownMenuItem key={macro.id} onClick={() => controller.openAction({ type: 'macro', macro })}><SquareTerminal />{macro.name}</DropdownMenuItem>)}</DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
      <Button size="sm" variant="destructive" disabled={props.selectedIDs.length === 0 || controller.executing} onClick={() => controller.openAction({ type: 'delete' })}><Trash2 />{t('批量删除')}</Button>
      {props.selectedIDs.length > 0 && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => props.onComplete(props.selectedIDs)}>{t('清除选择')}</Button>}
      {controller.macroError ? <p className="basis-full text-xs text-destructive" role="alert">{t('加载宏失败: ${}', controller.macroError)}</p> : null}
    </div>
    <BatchConfirmation action={pendingAction} count={pendingCount} executing={controller.executing} deleteImpact={controller.deleteImpact} impactError={controller.impactError} executeError={controller.executeError} onOpenChange={(open) => { if (!open) controller.closeAction() }} onConfirm={() => { void controller.execute() }} />
    <BatchResults results={controller.results} onClose={() => controller.setResults(null)} />
  </>
}


function BatchConfirmation({ action, count, executing, deleteImpact, impactError, executeError, onOpenChange, onConfirm }: { action: PendingAction | null; count: number; executing: boolean; deleteImpact: { tunnels: number; history: number; recordings: number; transfers: number } | null; impactError: string; executeError: string; onOpenChange: (open: boolean) => void; onConfirm: () => void }) {
  const operation = action?.type === 'macro'
    ? t('执行宏“${}”', action.macro.name)
    : action?.type === 'delete'
      ? t('删除选中会话')
      : t('建立 SSH 连接')
  const description = action?.type === 'delete'
    ? (impactError
      ? t('即将删除 ${} 个会话。分析关联资产影响失败：${}。仍可继续删除，但影响范围未知。此操作不可撤销。', count, impactError)
      : deleteImpact
        ? t('即将删除 ${} 个会话。将同时影响 ${} 条隧道、${} 条命令历史、${} 条录制记录和 ${} 个进行中传输。此操作不可撤销。', count, deleteImpact.tunnels, deleteImpact.history, deleteImpact.recordings, deleteImpact.transfers)
        : t('即将删除 ${} 个会话。正在分析关联资产影响范围。此操作不可撤销。', count))
    : t('即将为') + ` ${count} ` + t('个会话') + operation + t('。每个节点会独立执行，失败不会中断其他节点。')
  return <AlertDialog open={Boolean(action)} onOpenChange={onOpenChange}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{action?.type === 'delete' ? t('确认批量删除？') : t('确认批量操作？')}</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription></AlertDialogHeader>{executeError ? <p role="alert" className="text-sm text-destructive">{executeError}</p> : null}<AlertDialogFooter><AlertDialogCancel disabled={executing}>{t('取消')}</AlertDialogCancel><AlertDialogAction variant={action?.type === 'delete' ? 'destructive' : 'default'} disabled={executing} onClick={onConfirm}>{executing ? t('执行中…') : action?.type === 'delete' ? t('确认删除') : t('确认执行')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
}

function BatchResults({ results, onClose }: { results: BatchSessionResult[] | null; onClose: () => void }) {
  const succeeded = results?.filter((result) => result.success).length ?? 0
  return <AlertDialog open={results !== null} onOpenChange={(open) => { if (!open) onClose() }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('批量操作完成')}</AlertDialogTitle><AlertDialogDescription>{t('成功')} {succeeded} {t('项，失败')} {(results?.length ?? 0) - succeeded} {t('项。')}</AlertDialogDescription></AlertDialogHeader><div className="max-h-72 overflow-y-auto rounded-xl border border-border">{results?.map((result) => <div key={result.sessionId} className="flex items-start gap-3 border-b border-border px-3 py-2 last:border-b-0"><Badge variant={result.success ? 'default' : 'destructive'}>{result.success ? t('成功') : t('失败')}</Badge><div className="min-w-0"><div className="text-sm font-medium">{result.name}</div>{result.error && <div className="break-words text-xs text-destructive">{result.error}</div>}</div></div>)}</div><AlertDialogFooter><AlertDialogAction onClick={onClose}>{t('关闭')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
}
