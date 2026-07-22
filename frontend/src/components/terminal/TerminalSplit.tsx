import { createPortal } from 'react-dom'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { TerminalEmulator } from '@/components/terminal/TerminalEmulator'
import { SplitTreeView } from '@/components/terminal/TerminalSplitLayout'
import { toast } from '@/components/ui/toast'
import type { TerminalFocusRequest } from '@/hooks/useTerminal'
import { logger } from '@/lib/logger'
import { TerminalService } from '@/lib/wails'
import { useAppStore } from '@/store/appStore'
import { openTerminalWithPoolCapacity } from '@/lib/openTerminal'
import { isTerminalNotFoundError } from '@/store/tabNavigation'
import {
  collectLeaves,
  hasTerminal,
  insertSplit,
  removeTerminal,
  replaceTerminal,
  splitLeaf,
  terminalIDs,
  updateSplitRatio,
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

function openSplitTerminal(sessionId: number, connectionKind: 'ssh' | 'serial' | 'local' | undefined, serialPortId: number | undefined) {
  if (connectionKind === 'local') return TerminalService.OpenLocal(80, 24)
  if (connectionKind === 'serial' && serialPortId) return TerminalService.OpenSerial(serialPortId, 80, 24)
  return TerminalService.Open(sessionId, 80, 24)
}

function ensurePaneHost(hosts: Map<string, HTMLDivElement>, leafID: string, terminalID: string): HTMLDivElement {
  const existing = hosts.get(leafID)
  if (existing) {
    existing.dataset.testid = `pane-host-${terminalID}`
    return existing
  }
  const host = document.createElement('div')
  host.dataset.testid = `pane-host-${terminalID}`
  host.className = 'h-full w-full min-h-0 min-w-0'
  hosts.set(leafID, host)
  return host
}

export const TerminalSplit = forwardRef<TerminalSplitHandle, Props>(function TerminalSplit({
  tabID, primaryID, sessionId, connectionKind, serialPortId, active, focusRequest, onStateChange, onPaneClosed, onPaneReplaced, onCloseTerminal,
}, ref) {
  const [tree, setTree] = useState<SplitNode>(() => splitLeaf(primaryID))
  const [busy, setBusy] = useState(false)
  const [closingID, setClosingID] = useState<string | null>(null)
  const treeRef = useRef(tree)
  const mountedRef = useRef(true)
  const primaryRef = useRef(primaryID)
  const operationRef = useRef(false)
  const hostsRef = useRef(new Map<string, HTMLDivElement>())
  const stagingRef = useRef<HTMLDivElement | null>(null)
  const activePaneID = useAppStore((state) => state.activePaneId)
  treeRef.current = tree
  primaryRef.current = primaryID
  const leaves = useMemo(() => collectLeaves(tree), [tree])
  const paneCount = leaves.length

  useEffect(() => { onStateChange?.({ paneCount, busy }) }, [busy, onStateChange, paneCount])
  useEffect(() => () => {
    mountedRef.current = false
    for (const terminalID of terminalIDs(treeRef.current)) {
      if (terminalID !== primaryRef.current) closeInBackground(terminalID, 'TerminalSplit: cleanup failed')
    }
  }, [])

  useEffect(() => {
    const hosts = hostsRef.current
    const activeLeafIDs = new Set(leaves.map((leaf) => leaf.id))
    for (const leaf of leaves) ensurePaneHost(hosts, leaf.id, leaf.terminalID)
    for (const [leafID, host] of [...hosts.entries()]) {
      if (activeLeafIDs.has(leafID)) continue
      host.remove()
      hosts.delete(leafID)
    }
  }, [leaves])

  const requestFocus = (terminalID: string) => useAppStore.getState().requestTerminalFocus(tabID, terminalID)
  const lastUsed = (terminalID: string) => useAppStore.getState().terminalPool.get(terminalID)?.lastUsed ?? 0

  const registerSlot = useCallback((leafID: string, terminalID: string, slot: HTMLDivElement | null) => {
    const host = ensurePaneHost(hostsRef.current, leafID, terminalID)
    if (slot) {
      if (host.parentElement !== slot) slot.appendChild(host)
      return
    }
    const staging = stagingRef.current
    if (staging && host.parentElement !== staging) staging.appendChild(host)
  }, [])

  const split = async (direction: SplitDirection) => {
    if (operationRef.current) return
    if (terminalIDs(treeRef.current).length >= MAX_PANES) {
      toast(t('每个标签最多支持 8 个终端窗格'), 'warning')
      return
    }
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

  return <div className="relative flex h-full w-full min-h-0 min-w-0 flex-1">
    <div ref={stagingRef} className="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0" aria-hidden="true" />
    <SplitTreeView
      node={tree}
      primaryID={primaryID}
      activePaneID={activePaneID}
      paneCount={paneCount}
      closingID={closingID}
      onClose={(id) => { void closePane(id) }}
      onReconnect={(id) => { void reconnectPane(id) }}
      onCloseTerminal={closeDisconnectedTerminal}
      onRatio={(id, ratio) => setTree((current) => updateSplitRatio(current, id, ratio))}
      registerHost={registerSlot}
    />
    {leaves.map((leaf) => {
      const host = ensurePaneHost(hostsRef.current, leaf.id, leaf.terminalID)
      const selected = activePaneID ? activePaneID === leaf.terminalID : primaryID === leaf.terminalID
      const request = focusRequest.targetTerminalID === leaf.terminalID ? focusRequest : noFocusRequest
      return createPortal(
        <TerminalEmulator
          key={leaf.id}
          terminalID={leaf.terminalID}
          active={active && selected}
          focusRequest={request}
          className="h-full w-full min-h-0 min-w-0"
        />,
        host,
        leaf.id,
      )
    })}
  </div>
})
