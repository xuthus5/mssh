import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { RefreshCw, WifiOff, X } from 'lucide-react'
import { TerminalEmulator } from '@/components/terminal/TerminalEmulator'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import type { TerminalFocusRequest } from '@/hooks/useTerminal'
import { logger } from '@/lib/logger'
import { TerminalService } from '@/lib/wails'
import { useAppStore } from '@/store/appStore'
import { isTerminalNotFoundError } from '@/store/tabNavigation'
import {
  hasTerminal,
  insertSplit,
  removeTerminal,
  replaceTerminal,
  splitLeaf,
  terminalIDs,
  updateSplitRatio,
  type SplitBranch,
  type SplitDirection,
  type SplitNode,
} from '@/components/terminal/splitTree'

const MAX_PANES = 8
const noFocusRequest: TerminalFocusRequest = { sequence: 0, targetTerminalID: null }

export interface TerminalSplitHandle {
  split: (direction: SplitDirection) => void
}

interface Props {
  tabID: string
  primaryID: string
  sessionId: number
  active: boolean
  focusRequest: TerminalFocusRequest
  onStateChange?: (state: { paneCount: number; busy: boolean }) => void
  onPaneClosed?: (terminalID: string) => void
  onPaneReplaced?: (previousID: string, nextID: string) => void
}

function closeInBackground(terminalID: string, context: string) {
  void TerminalService.Close(terminalID).catch((error: unknown) => {
    if (!isTerminalNotFoundError(error)) logger.error(context, error)
  })
}

function ConnectionOverlay({ terminalID, onReconnect }: { terminalID: string; onReconnect: () => void }) {
  const status = useAppStore((state) => state.connectionStatus[terminalID])
  if (status === undefined || status === 'connected') return null
  const connecting = status === 'connecting' || status === 'reconnecting'
  return <div className="absolute inset-0 z-10 grid place-items-center bg-background/70 p-4 backdrop-blur-[1px]">
    <div className="flex max-w-xs flex-col items-center rounded-xl border border-border bg-card/95 p-4 text-center shadow-lg">
      {connecting ? <RefreshCw className="mb-2 size-6 animate-spin text-primary" /> : <WifiOff className="mb-2 size-6 text-destructive" />}
      <p className="text-sm font-semibold">{connecting ? '正在重新连接' : '连接已断开'}</p>
      <Button type="button" size="sm" className="mt-3" disabled={connecting} onClick={onReconnect}>
        <RefreshCw />重新连接
      </Button>
    </div>
  </div>
}

interface TreeViewProps {
  node: SplitNode
  primaryID: string
  active: boolean
  activePaneID: string | null
  focusRequest: TerminalFocusRequest
  paneCount: number
  closingID: string | null
  onClose: (terminalID: string) => void
  onReconnect: (terminalID: string) => void
  onRatio: (branchID: string, ratio: number) => void
}

function LeafView(props: TreeViewProps & { node: Extract<SplitNode, { kind: 'leaf' }> }) {
  const terminalID = props.node.terminalID
  const selected = props.activePaneID ? props.activePaneID === terminalID : props.primaryID === terminalID
  const request = props.focusRequest.targetTerminalID === terminalID ? props.focusRequest : noFocusRequest
  return <div className={`group relative h-full w-full min-h-0 min-w-0 flex-1 overflow-hidden ${selected ? 'ring-1 ring-inset ring-primary/35' : ''}`}>
    <TerminalEmulator key={terminalID} terminalID={terminalID} active={props.active && selected} focusRequest={request} />
    {props.paneCount > 1 ? <button type="button" title="关闭当前窗格" aria-label="关闭当前窗格"
      disabled={props.closingID !== null} onClick={() => props.onClose(terminalID)}
      className="absolute right-2 top-2 z-20 grid size-6 place-items-center rounded-md bg-background/80 text-muted-foreground opacity-0 shadow-sm ring-1 ring-border backdrop-blur transition hover:bg-destructive hover:text-destructive-foreground group-hover:opacity-100 focus-visible:opacity-100 disabled:pointer-events-none">
      <X className="size-3.5" />
    </button> : null}
    <ConnectionOverlay terminalID={terminalID} onReconnect={() => props.onReconnect(terminalID)} />
  </div>
}

function Divider({ branch, onRatio }: { branch: SplitBranch; onRatio: (branchID: string, ratio: number) => void }) {
  const horizontal = branch.direction === 'horizontal'
  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const container = event.currentTarget.parentElement
    if (!container) return
    const move = (pointer: PointerEvent) => {
      const rect = container.getBoundingClientRect()
      const position = horizontal ? pointer.clientX - rect.left : pointer.clientY - rect.top
      const size = horizontal ? rect.width : rect.height
      if (size > 0) onRatio(branch.id, position / size * 100)
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
  }
  return <div role="separator" aria-orientation={horizontal ? 'vertical' : 'horizontal'} onPointerDown={startDrag}
    className={`z-20 shrink-0 touch-none bg-border/70 transition-colors hover:bg-primary ${horizontal ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'}`} />
}

function TreeView(props: TreeViewProps) {
  if (props.node.kind === 'leaf') return <LeafView {...props} node={props.node} />
  const horizontal = props.node.direction === 'horizontal'
  const shared = { ...props, node: props.node.first }
  return <div className={`flex min-h-0 min-w-0 flex-1 ${horizontal ? 'flex-row' : 'flex-col'}`}>
    <div className="flex min-h-0 min-w-0" style={{ flexBasis: `${props.node.ratio}%` }}><TreeView {...shared} /></div>
    <Divider branch={props.node} onRatio={props.onRatio} />
    <div className="flex min-h-0 min-w-0 flex-1"><TreeView {...props} node={props.node.second} /></div>
  </div>
}

export const TerminalSplit = forwardRef<TerminalSplitHandle, Props>(function TerminalSplit({ tabID, primaryID, sessionId, active, focusRequest, onStateChange, onPaneClosed, onPaneReplaced }, ref) {
  const [tree, setTree] = useState<SplitNode>(() => splitLeaf(primaryID))
  const [busy, setBusy] = useState(false)
  const [closingID, setClosingID] = useState<string | null>(null)
  const treeRef = useRef(tree)
  const mountedRef = useRef(true)
  const primaryRef = useRef(primaryID)
  const operationRef = useRef(false)
  const activePaneID = useAppStore((state) => state.activePaneId)
  treeRef.current = tree
  primaryRef.current = primaryID
  const paneCount = terminalIDs(tree).length

  useEffect(() => { onStateChange?.({ paneCount, busy }) }, [busy, onStateChange, paneCount])
  useEffect(() => () => {
    mountedRef.current = false
    for (const terminalID of terminalIDs(treeRef.current)) {
      if (terminalID !== primaryRef.current) closeInBackground(terminalID, 'TerminalSplit: cleanup failed')
    }
  }, [])

  const requestFocus = (terminalID: string) => useAppStore.getState().requestTerminalFocus(tabID, terminalID)
  const lastUsed = (terminalID: string) => useAppStore.getState().terminalPool.get(terminalID)?.lastUsed ?? 0

  const split = async (direction: SplitDirection) => {
    if (operationRef.current) return
    if (terminalIDs(treeRef.current).length >= MAX_PANES) return void toast(`单个标签最多支持 ${MAX_PANES} 个终端窗格`, 'info')
    const targetID = activePaneID && hasTerminal(treeRef.current, activePaneID) ? activePaneID : primaryID
    operationRef.current = true
    setBusy(true)
    try {
      const terminalID = await TerminalService.Open(sessionId, 80, 24)
      if (!mountedRef.current) return closeInBackground(terminalID, 'TerminalSplit: cancelled split cleanup failed')
      setTree((current) => insertSplit(current, targetID, terminalID, direction, crypto.randomUUID()))
      useAppStore.getState().setConnectionStatus(terminalID, 'connected')
      requestFocus(terminalID)
    } catch (error: unknown) {
      logger.error('TerminalSplit: failed to open split', error)
      toast(`创建分屏失败: ${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      operationRef.current = false
      if (mountedRef.current) setBusy(false)
    }
  }
  useImperativeHandle(ref, () => ({ split: (direction) => { void split(direction) } }))

  const closePane = async (terminalID: string) => {
    if (operationRef.current || terminalIDs(treeRef.current).length === 1) return
    operationRef.current = true
    setBusy(true)
    setClosingID(terminalID)
    try {
      await TerminalService.Close(terminalID).catch((error: unknown) => { if (!isTerminalNotFoundError(error)) throw error })
      const result = removeTerminal(treeRef.current, terminalID, lastUsed)
      if (!result) return
      if (terminalID === primaryID) {
        primaryRef.current = result.focusID
        useAppStore.getState().promoteTerminalConnection(tabID, terminalID, result.focusID)
      } else {
        useAppStore.getState().forgetTerminal(terminalID)
      }
      setTree(result.node)
      onPaneClosed?.(terminalID)
      requestFocus(result.focusID)
    } catch (error: unknown) {
      logger.error('TerminalSplit: failed to close pane', error)
      toast(`关闭分屏失败: ${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      operationRef.current = false
      if (mountedRef.current) setBusy(false)
      if (mountedRef.current) setClosingID(null)
    }
  }

  const reconnectPane = async (terminalID: string) => {
    if (operationRef.current) return
    operationRef.current = true
    useAppStore.getState().setConnectionStatus(terminalID, 'reconnecting')
    setBusy(true)
    try {
      const nextID = await TerminalService.Open(sessionId, 80, 24)
      if (!mountedRef.current) return closeInBackground(nextID, 'TerminalSplit: cancelled reconnect cleanup failed')
      setTree((current) => replaceTerminal(current, terminalID, nextID))
      if (terminalID === primaryID) {
        primaryRef.current = nextID
        useAppStore.getState().promoteTerminalConnection(tabID, terminalID, nextID)
      } else {
        useAppStore.getState().forgetTerminal(terminalID)
      }
      useAppStore.getState().setConnectionStatus(nextID, 'connected')
      onPaneReplaced?.(terminalID, nextID)
      closeInBackground(terminalID, 'TerminalSplit: old reconnect terminal cleanup failed')
      requestFocus(nextID)
    } catch (error: unknown) {
      useAppStore.getState().setConnectionStatus(terminalID, 'error')
      toast(`重新连接失败: ${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      operationRef.current = false
      if (mountedRef.current) setBusy(false)
    }
  }

  return <div className="flex h-full w-full min-h-0 min-w-0 flex-1">
    <TreeView node={tree} primaryID={primaryID} active={active} activePaneID={activePaneID} focusRequest={focusRequest}
      paneCount={paneCount} closingID={closingID} onClose={(id) => { void closePane(id) }}
      onReconnect={(id) => { void reconnectPane(id) }} onRatio={(id, ratio) => setTree((current) => updateSplitRatio(current, id, ratio))} />
  </div>
})
