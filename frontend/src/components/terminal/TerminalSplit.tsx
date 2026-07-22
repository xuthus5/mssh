import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { RefreshCw, WifiOff, X } from 'lucide-react'
import { TerminalEmulator } from '@/components/terminal/TerminalEmulator'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import type { TerminalFocusRequest } from '@/hooks/useTerminal'
import { logger } from '@/lib/logger'
import { TerminalService } from '@/lib/wails'
import { useAppStore } from '@/store/appStore'
import { openTerminalWithPoolCapacity } from '@/lib/openTerminal'
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
import { t } from '@/i18n'


const MAX_PANES = 8
const noFocusRequest: TerminalFocusRequest = { sequence: 0, targetTerminalID: null }

export interface TerminalSplitHandle {
  split: (direction: SplitDirection) => void
}

interface Props {
  tabID: string
  primaryID: string
  sessionId: number
  connectionKind?: 'ssh' | 'serial' | 'local'
  serialPortId?: number
  active: boolean
  focusRequest: TerminalFocusRequest
  onStateChange?: (state: { paneCount: number; busy: boolean }) => void
  onPaneClosed?: (terminalID: string) => void
  onPaneReplaced?: (previousID: string, nextID: string) => void
  onCloseTerminal?: () => void
}

function closeInBackground(terminalID: string, context: string) {
  void TerminalService.Close(terminalID).catch((error: unknown) => {
    if (!isTerminalNotFoundError(error)) logger.error(context, error)
  })
}

function ConnectionOverlay({ terminalID, onReconnect, onClose }: { terminalID: string; onReconnect: () => void; onClose: () => void }) {
  const status = useAppStore((state) => state.connectionStatus[terminalID])
  if (status === undefined || status === 'connected') return null
  const connecting = status === 'connecting' || status === 'reconnecting'
  return <div role="alert" aria-live="polite" className="absolute inset-0 z-10 grid place-items-center bg-background/70 p-6 backdrop-blur-[1px]">
    <div className="flex w-full max-w-sm flex-col items-center rounded-xl border border-border bg-card/95 p-5 text-center shadow-lg">
      {connecting ? <RefreshCw aria-hidden="true" className="mb-3 size-8 animate-spin text-primary" /> : <WifiOff aria-hidden="true" className="mb-3 size-8 text-destructive" />}
      <h3 className="text-sm font-semibold text-foreground">{connecting ? t('正在重新连接') : t('连接已断开')}</h3>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        {connecting ? t('正在为当前终端创建新的连接通道。') : t('会话可能因空闲超时、进程退出或网络中断而结束，可在当前终端中重新连接。')}
      </p>
      <div className="mt-4 flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={connecting} onClick={onClose}><X />{t('关闭终端')}</Button>
        <Button type="button" size="sm" disabled={connecting} onClick={onReconnect}><RefreshCw />{connecting ? t('正在重连') : t('重新连接')}</Button>
      </div>
    </div>
  </div>
}

function replaceSecondaryTerminalRuntime(previousID: string, nextID: string) {
  useAppStore.setState((state) => {
    const terminalPool = new Map(state.terminalPool)
    const terminal = terminalPool.get(previousID)
    terminalPool.delete(previousID)
    if (terminal) terminalPool.set(nextID, terminal)
    const connectionStatus = { ...state.connectionStatus }
    delete connectionStatus[previousID]
    connectionStatus[nextID] = 'connected'
    const recordingState = { ...state.recordingState }
    delete recordingState[previousID]
    return { terminalPool, connectionStatus, recordingState, activePaneId: state.activePaneId === previousID ? nextID : state.activePaneId }
  })
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
  onCloseTerminal: (terminalID: string) => void
  onRatio: (branchID: string, ratio: number) => void
}

function LeafView(props: TreeViewProps & { node: Extract<SplitNode, { kind: 'leaf' }> }) {
  const terminalID = props.node.terminalID
  const selected = props.activePaneID ? props.activePaneID === terminalID : props.primaryID === terminalID
  const request = props.focusRequest.targetTerminalID === terminalID ? props.focusRequest : noFocusRequest
  return <div className={`group relative h-full w-full min-h-0 min-w-0 flex-1 overflow-hidden ${selected ? 'ring-1 ring-inset ring-primary/35' : ''}`}>
    <TerminalEmulator key={props.node.id} terminalID={terminalID} active={props.active && selected} focusRequest={request} />
    {props.paneCount > 1 ? <button type="button" title={t('关闭当前窗格')} aria-label={t('关闭当前窗格')}
      disabled={props.closingID !== null} onClick={() => props.onClose(terminalID)}
      className="absolute right-2 top-2 z-20 grid size-6 place-items-center rounded-md bg-background/80 text-muted-foreground opacity-0 shadow-sm ring-1 ring-border backdrop-blur transition hover:bg-destructive hover:text-destructive-foreground group-hover:opacity-100 focus-visible:opacity-100 disabled:pointer-events-none">
      <X className="size-3.5" />
    </button> : null}
    <ConnectionOverlay terminalID={terminalID} onReconnect={() => props.onReconnect(terminalID)} onClose={() => props.onCloseTerminal(terminalID)} />
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

function openSplitTerminal(sessionId: number, connectionKind: 'ssh' | 'serial' | 'local' | undefined, serialPortId: number | undefined) {
  if (connectionKind === 'local') return TerminalService.OpenLocal(80, 24)
  if (connectionKind === 'serial' && serialPortId) return TerminalService.OpenSerial(serialPortId, 80, 24)
  return TerminalService.Open(sessionId, 80, 24)
}

export const TerminalSplit = forwardRef<TerminalSplitHandle, Props>(function TerminalSplit({ tabID, primaryID, sessionId, connectionKind, serialPortId, active, focusRequest, onStateChange, onPaneClosed, onPaneReplaced, onCloseTerminal }, ref) {
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
    if (terminalIDs(treeRef.current).length >= MAX_PANES) return void toast(t('单个标签最多支持 ${} 个终端窗格', MAX_PANES), 'info')
    const targetID = activePaneID && hasTerminal(treeRef.current, activePaneID) ? activePaneID : primaryID
    operationRef.current = true
    setBusy(true)
    try {
      const terminalID = await openTerminalWithPoolCapacity(() => openSplitTerminal(sessionId, connectionKind, serialPortId))
      if (!mountedRef.current) return closeInBackground(terminalID, 'TerminalSplit: cancelled split cleanup failed')
      setTree((current) => insertSplit(current, targetID, terminalID, direction, crypto.randomUUID()))
      useAppStore.getState().setConnectionStatus(terminalID, 'connected')
      requestFocus(terminalID)
    } catch (error: unknown) {
      logger.error('TerminalSplit: failed to open split', error)
      toast(t('创建分屏失败: ${}', error instanceof Error ? error.message : String(error)), 'error')
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
      toast(t('关闭分屏失败: ${}', error instanceof Error ? error.message : String(error)), 'error')
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
      const nextID = await openTerminalWithPoolCapacity(() => openSplitTerminal(sessionId, connectionKind, serialPortId))
      if (!mountedRef.current) return closeInBackground(nextID, 'TerminalSplit: cancelled reconnect cleanup failed')
      setTree((current) => replaceTerminal(current, terminalID, nextID))
      if (terminalID === primaryID) {
        primaryRef.current = nextID
        useAppStore.getState().replaceTerminalConnection(tabID, terminalID, nextID)
      } else {
        replaceSecondaryTerminalRuntime(terminalID, nextID)
      }
      useAppStore.getState().setConnectionStatus(nextID, 'connected')
      onPaneReplaced?.(terminalID, nextID)
      closeInBackground(terminalID, 'TerminalSplit: old reconnect terminal cleanup failed')
      requestFocus(nextID)
    } catch (error: unknown) {
      useAppStore.getState().setConnectionStatus(terminalID, 'error')
      toast(t('重新连接失败: ${}', error instanceof Error ? error.message : String(error)), 'error')
    } finally {
      operationRef.current = false
      if (mountedRef.current) setBusy(false)
    }
  }

  const closeDisconnectedTerminal = (terminalID: string) => {
    if (terminalIDs(treeRef.current).length === 1) {
      onCloseTerminal?.()
      return
    }
    void closePane(terminalID)
  }

  return <div className="flex h-full w-full min-h-0 min-w-0 flex-1">
    <TreeView node={tree} primaryID={primaryID} active={active} activePaneID={activePaneID} focusRequest={focusRequest}
      paneCount={paneCount} closingID={closingID} onClose={(id) => { void closePane(id) }}
      onReconnect={(id) => { void reconnectPane(id) }} onCloseTerminal={closeDisconnectedTerminal}
      onRatio={(id, ratio) => setTree((current) => updateSplitRatio(current, id, ratio))} />
  </div>
})
