import { useEffect, useState } from 'react'
import { Cable, Play, SquareTerminal } from 'lucide-react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { toast } from '@/components/ui/toast'
import { MacroService } from '@/lib/wails'
import type { BatchSessionResult } from '@/lib/sessionBatch'

interface MacroOption { id: number; name: string; command: string }
type PendingAction = { type: 'connect' } | { type: 'macro'; macro: MacroOption }

interface Props {
  selectedIDs: string[]
  onBatchConnect: (sessionIDs: string[]) => Promise<BatchSessionResult[]>
  onBatchExecuteMacro: (sessionIDs: string[], command: string) => Promise<BatchSessionResult[]>
  onComplete: () => void
}

export function SessionBatchActions({ selectedIDs, onBatchConnect, onBatchExecuteMacro, onComplete }: Props) {
  const [macros, setMacros] = useState<MacroOption[]>([])
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [results, setResults] = useState<BatchSessionResult[] | null>(null)
  const [executing, setExecuting] = useState(false)
  useEffect(() => {
    let current = true
    void MacroService.List().then((items) => { if (current) setMacros(items ?? []) })
      .catch((error: unknown) => toast(`加载宏失败: ${error instanceof Error ? error.message : String(error)}`, 'error'))
    return () => { current = false }
  }, [])

  const execute = async () => {
    if (!pendingAction || executing) return
    setExecuting(true)
    try {
      const next = pendingAction.type === 'connect'
        ? await onBatchConnect(selectedIDs)
        : await onBatchExecuteMacro(selectedIDs, pendingAction.macro.command)
      setResults(next)
      setPendingAction(null)
      onComplete()
    } catch (error) {
      toast(`批量操作失败: ${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      setExecuting(false)
    }
  }

  return <>
    <div className="flex min-h-9 items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-sm">
      <Badge variant="secondary">已选 {selectedIDs.length} 项</Badge>
      <Button size="sm" variant="outline" disabled={selectedIDs.length === 0 || executing} onClick={() => setPendingAction({ type: 'connect' })}><Cable />批量连接</Button>
      <DropdownMenu><DropdownMenuTrigger render={<Button size="sm" variant="outline" disabled={selectedIDs.length === 0 || macros.length === 0 || executing} />}><Play />执行宏</DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuGroup>{macros.map((macro) => <DropdownMenuItem key={macro.id} onClick={() => setPendingAction({ type: 'macro', macro })}><SquareTerminal />{macro.name}</DropdownMenuItem>)}</DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
      {selectedIDs.length > 0 && <Button size="sm" variant="ghost" className="ml-auto" onClick={onComplete}>清除选择</Button>}
    </div>
    <BatchConfirmation action={pendingAction} count={selectedIDs.length} executing={executing} onOpenChange={(open) => { if (!open && !executing) setPendingAction(null) }} onConfirm={() => { void execute() }} />
    <BatchResults results={results} onClose={() => setResults(null)} />
  </>
}

function BatchConfirmation({ action, count, executing, onOpenChange, onConfirm }: { action: PendingAction | null; count: number; executing: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void }) {
  const operation = action?.type === 'macro' ? `执行宏“${action.macro.name}”` : '建立 SSH 连接'
  return <AlertDialog open={Boolean(action)} onOpenChange={onOpenChange}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>确认批量操作？</AlertDialogTitle><AlertDialogDescription>即将为 {count} 个会话{operation}。每个节点会独立执行，失败不会中断其他节点。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={executing}>取消</AlertDialogCancel><AlertDialogAction disabled={executing} onClick={onConfirm}>{executing ? '执行中…' : '确认执行'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
}

function BatchResults({ results, onClose }: { results: BatchSessionResult[] | null; onClose: () => void }) {
  const succeeded = results?.filter((result) => result.success).length ?? 0
  return <AlertDialog open={results !== null} onOpenChange={(open) => { if (!open) onClose() }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>批量操作完成</AlertDialogTitle><AlertDialogDescription>成功 {succeeded} 项，失败 {(results?.length ?? 0) - succeeded} 项。</AlertDialogDescription></AlertDialogHeader><div className="max-h-72 overflow-y-auto rounded-xl border border-border">{results?.map((result) => <div key={result.sessionId} className="flex items-start gap-3 border-b border-border px-3 py-2 last:border-b-0"><Badge variant={result.success ? 'default' : 'destructive'}>{result.success ? '成功' : '失败'}</Badge><div className="min-w-0"><div className="text-sm font-medium">{result.name}</div>{result.error && <div className="break-words text-xs text-destructive">{result.error}</div>}</div></div>)}</div><AlertDialogFooter><AlertDialogAction onClick={onClose}>关闭</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
}
