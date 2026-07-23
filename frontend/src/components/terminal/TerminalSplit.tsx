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
import {
  closeInBackground,
  ensurePaneHost,
  openSplitTerminal,
  persistTabSplitLayout,
  replaceSecondaryTerminalRuntime,
} from '@/components/terminal/splitPersistence'
import { t } from '@/i18n'
import { useSplitLayoutRestore } from '@/components/terminal/useSplitLayoutRestore'

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

function bgClose(terminalID: string, context: string) {
  closeInBackground(terminalID, context, isTerminalNotFoundError)
}

function openPane(sessionId: number, connectionKind: Props['connectionKind'], serialPortId: number | undefined, preferredTerminalID: string) {
  return openSplitTerminal(sessionId, connectionKind, serialPortId, t('串口终端为设备独占，不支持分屏'), preferredTerminalID)
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
  const requestFocus = (terminalID: string) => useAppStore.getState().requestTerminalFocus(tabID, terminalID)
  const lastUsed = (terminalID: string) => useAppStore.getState().terminalPool.get(terminalID)?.lastUsed ?? 0
  const layoutReady = useSplitLayoutRestore({
    tabID, sessionId, connectionKind, serialPortId, primaryID,
    operationRef, mountedRef, setTree, setBusy, requestFocus,
  })

  useEffect(() => { onStateChange?.({ paneCount, busy }) }, [busy, onStateChange, paneCount])

  useEffect(() => {
    if (!layoutReady) return
    persistTabSplitLayout(tabID, tree, primaryID, connectionKind)
  }, [tabID, tree, primaryID, connectionKind, layoutReady])

  useEffect(() => {
    if (!primaryID) return
    setTree((current) => {
      if (hasTerminal(current, primaryID)) return current
      const previousPrimary = primaryRef.current
      if (previousPrimary && previousPrimary !== primaryID && hasTerminal(current, previousPrimary)) {
        return replaceTerminal(current, previousPrimary, primaryID)
      }
      const currentLeaves = collectLeaves(current)
      if (currentLeaves.length === 0) return splitLeaf(primaryID)
      return replaceTerminal(current, currentLeaves[0].terminalID, primaryID)
    })
    primaryRef.current = primaryID
  }, [primaryID])

  useEffect(() => () => {
    mountedRef.current = false
    for (const terminalID of terminalIDs(treeRef.current)) {
      if (terminalID !== primaryRef.current) bgClose(terminalID, 'TerminalSplit: cleanup failed')
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

  const registerSlot = useCallback((leafID: string, terminalID: string, slot: HTMLDivElement | null) => {
    const host = ensurePaneHost(hostsRef.current, leafID, terminalID)
    let moved = false
    if (slot) {
      if (host.parentElement !== slot) {
        slot.appendChild(host)
        moved = true
      }
    } else {
      const staging = stagingRef.current
      if (staging && host.parentElement !== staging) {
        staging.appendChild(host)
        moved = true
      }
    }
    // Reparenting can leave xterm/WebGL at zero size or with a lost GL context.
    if (moved) {
      window.dispatchEvent(new CustomEvent('mssh:terminal-host-moved', { detail: { terminalID } }))
    }
  }, [])

  const split = async (direction: SplitDirection) => {
    if (operationRef.current || connectionKind === 'serial') {
      if (connectionKind === 'serial') toast(t('串口终端为设备独占，不支持分屏'), 'warning')
      return
    }
    if (terminalIDs(treeRef.current).length >= MAX_PANES) {
      toast(t('每个标签最多支持 8 个终端窗格'), 'warning')
      return
    }
    const targetID = activePaneID && hasTerminal(treeRef.current, activePaneID) ? activePaneID : primaryID
    operationRef.current = true
    setBusy(true)
    try {
      const terminalID = await openTerminalWithPoolCapacity(() => openPane(sessionId, connectionKind, serialPortId, primaryRef.current))
      if (!mountedRef.current) return bgClose(terminalID, 'TerminalSplit: cancelled split cleanup failed')
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
    if (operationRef.current || connectionKind === 'serial') return
    operationRef.current = true
    useAppStore.getState().setConnectionStatus(terminalID, 'reconnecting')
    setBusy(true)
    try {
      const nextID = await openTerminalWithPoolCapacity(() => openPane(sessionId, connectionKind, serialPortId, primaryRef.current))
      if (!mountedRef.current) return bgClose(nextID, 'TerminalSplit: cancelled reconnect cleanup failed')
      setTree((current) => replaceTerminal(current, terminalID, nextID))
      if (terminalID === primaryID) {
        primaryRef.current = nextID
        useAppStore.getState().replaceTerminalConnection(tabID, terminalID, nextID)
      } else {
        replaceSecondaryTerminalRuntime(terminalID, nextID, tabID)
      }
      useAppStore.getState().setConnectionStatus(nextID, 'connected')
      onPaneReplaced?.(terminalID, nextID)
      bgClose(terminalID, 'TerminalSplit: old reconnect terminal cleanup failed')
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
