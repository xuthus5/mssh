import { useEffect, useState } from 'react'
import { Cable, Play, SquareTerminal, Trash2 } from 'lucide-react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { toast } from '@/components/ui/toast'
import { MacroService, SessionService } from '@/lib/wails'
import type { BatchSessionResult } from '@/lib/sessionBatch'
import { t } from '@/i18n'

interface MacroOption { id: number; name: string; command: string }
type PendingAction =
  | { type: 'connect' }
  | { type: 'macro'; macro: MacroOption }
  | { type: 'delete' }

interface Props {
  selectedIDs: string[]
  onBatchConnect: (sessionIDs: string[]) => Promise<BatchSessionResult[]>
  onBatchExecuteMacro: (sessionIDs: string[], command: string) => Promise<BatchSessionResult[]>
  onBatchDelete: (sessionIDs: string[]) => Promise<BatchSessionResult[]>
  onComplete: () => void
}

export function SessionBatchActions({ selectedIDs, onBatchConnect, onBatchExecuteMacro, onBatchDelete, onComplete }: Props) {
  const [macros, setMacros] = useState<MacroOption[]>([])
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [results, setResults] = useState<BatchSessionResult[] | null>(null)
  const [executing, setExecuting] = useState(false)
  const [deleteImpact, setDeleteImpact] = useState<{ tunnels: number; history: number; recordings: number } | null>(null)

  useEffect(() => {
    let current = true
    void MacroService.List().then((items) => { if (current) setMacros(items ?? []) })
      .catch((error) => { if (current) loggerSafe(error) })
    return () => { current = false }
  }, [])

  useEffect(() => {
    if (pendingAction?.type !== 'delete') {
      setDeleteImpact(null)
      return
    }
    let current = true
    void SessionService.SessionsDeleteImpact(selectedIDs.map(Number))
      .then((value) => { if (current) setDeleteImpact(value ? { tunnels: value.tunnels, history: value.history, recordings: value.recordings } : { tunnels: 0, history: 0, recordings: 0 }) })
      .catch(() => { if (current) setDeleteImpact({ tunnels: 0, history: 0, recordings: 0 }) })
    return () => { current = false }
  }, [pendingAction, selectedIDs])

  const execute = async () => {
    if (!pendingAction) return
    setExecuting(true)
    try {
      const nextResults = pendingAction.type === 'connect'
        ? await onBatchConnect(selectedIDs)
        : pendingAction.type === 'macro'
          ? await onBatchExecuteMacro(selectedIDs, pendingAction.macro.command)
          : await onBatchDelete(selectedIDs)
      setResults(nextResults)
      setPendingAction(null)
      onComplete()
    } catch (error) {
      toast(t('批量操作失败: ${}', error instanceof Error ? error.message : String(error)), 'error')
    } finally {
      setExecuting(false)
    }
  }

  return <>
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-sm">
      <Badge variant="secondary">{t('已选')} {selectedIDs.length} {t('项')}</Badge>
      <Button size="sm" variant="outline" disabled={selectedIDs.length === 0 || executing} onClick={() => setPendingAction({ type: 'connect' })}><Cable />{t('批量连接')}</Button>
      <DropdownMenu><DropdownMenuTrigger render={<Button size="sm" variant="outline" disabled={selectedIDs.length === 0 || macros.length === 0 || executing} />}><Play />{t('执行宏')}</DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuGroup>{macros.map((macro) => <DropdownMenuItem key={macro.id} onClick={() => setPendingAction({ type: 'macro', macro })}><SquareTerminal />{macro.name}</DropdownMenuItem>)}</DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
      <Button size="sm" variant="destructive" disabled={selectedIDs.length === 0 || executing} onClick={() => setPendingAction({ type: 'delete' })}><Trash2 />{t('批量删除')}</Button>
      {selectedIDs.length > 0 && <Button size="sm" variant="ghost" className="ml-auto" onClick={onComplete}>{t('清除选择')}</Button>}
    </div>
    <BatchConfirmation action={pendingAction} count={selectedIDs.length} executing={executing} deleteImpact={deleteImpact} onOpenChange={(open) => { if (!open && !executing) setPendingAction(null) }} onConfirm={() => { void execute() }} />
    <BatchResults results={results} onClose={() => setResults(null)} />
  </>
}

function loggerSafe(error: unknown) {
  // Macro list failure should not block other batch actions.
  void error
}

function BatchConfirmation({ action, count, executing, deleteImpact, onOpenChange, onConfirm }: { action: PendingAction | null; count: number; executing: boolean; deleteImpact: { tunnels: number; history: number; recordings: number } | null; onOpenChange: (open: boolean) => void; onConfirm: () => void }) {
  const operation = action?.type === 'macro'
    ? t('执行宏“${}”', action.macro.name)
    : action?.type === 'delete'
      ? t('删除选中会话')
      : t('建立 SSH 连接')
  const description = action?.type === 'delete'
    ? (deleteImpact
      ? t('即将删除 ${} 个会话。将同时影响 ${} 条隧道、${} 条命令历史和 ${} 条录制记录。此操作不可撤销。', count, deleteImpact.tunnels, deleteImpact.history, deleteImpact.recordings)
      : t('即将删除 ${} 个会话。正在分析关联资产影响范围。此操作不可撤销。', count))
    : t('即将为') + ` ${count} ` + t('个会话') + operation + t('。每个节点会独立执行，失败不会中断其他节点。')
  return <AlertDialog open={Boolean(action)} onOpenChange={onOpenChange}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{action?.type === 'delete' ? t('确认批量删除？') : t('确认批量操作？')}</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={executing}>{t('取消')}</AlertDialogCancel><AlertDialogAction variant={action?.type === 'delete' ? 'destructive' : 'default'} disabled={executing} onClick={onConfirm}>{executing ? t('执行中…') : action?.type === 'delete' ? t('确认删除') : t('确认执行')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
}

function BatchResults({ results, onClose }: { results: BatchSessionResult[] | null; onClose: () => void }) {
  const succeeded = results?.filter((result) => result.success).length ?? 0
  return <AlertDialog open={results !== null} onOpenChange={(open) => { if (!open) onClose() }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('批量操作完成')}</AlertDialogTitle><AlertDialogDescription>{t('成功')} {succeeded} {t('项，失败')} {(results?.length ?? 0) - succeeded} {t('项。')}</AlertDialogDescription></AlertDialogHeader><div className="max-h-72 overflow-y-auto rounded-xl border border-border">{results?.map((result) => <div key={result.sessionId} className="flex items-start gap-3 border-b border-border px-3 py-2 last:border-b-0"><Badge variant={result.success ? 'default' : 'destructive'}>{result.success ? t('成功') : t('失败')}</Badge><div className="min-w-0"><div className="text-sm font-medium">{result.name}</div>{result.error && <div className="break-words text-xs text-destructive">{result.error}</div>}</div></div>)}</div><AlertDialogFooter><AlertDialogAction onClick={onClose}>{t('关闭')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
}
