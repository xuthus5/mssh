import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type MutableRefObject } from 'react'
import type { TerminalFocusRequest } from '@/hooks/useTerminal'
import { useAppStore } from '@/store/appStore'
import {
  collectLeaves,
  hasTerminal,
  removeTerminal,
  replaceTerminal,
  splitLeaf,
  terminalIDs,
  updateSplitRatio,
  type SplitDirection,
  type SplitNode,
} from '@/components/terminal/splitTree'
import {
  ensurePaneHost,
  persistTabSplitLayout,
} from '@/components/terminal/splitPersistence'
import { useSplitLayoutRestore } from '@/components/terminal/useSplitLayoutRestore'
import {
  TERMINAL_CLOSED_SPLIT_PANE_EVENT,
  type TerminalClosedSplitPaneDetail,
} from '@/hooks/sessionReconnect'
import {
  closeSplitPane,
  closeSplitTerminalInBackground,
  reconnectSplitPane,
  splitPane,
} from '@/components/terminal/terminalSplitActions'
import { useSplitAutoReconnect } from '@/components/terminal/useSplitAutoReconnect'
import { TerminalSplitView } from '@/components/terminal/TerminalSplitView'

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

function useSplitModel(props: Props) {
  const [tree, setTree] = useState<SplitNode>(() => splitLeaf(props.primaryID))
  const [busy, setBusy] = useState(false)
  const [closingID, setClosingID] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const treeRef = useRef(tree)
  const mountedRef = useRef(true)
  const primaryRef = useRef(props.primaryID)
  const operationRef = useRef(false)
  const hostsRef = useRef(new Map<string, HTMLDivElement>())
  const stagingRef = useRef<HTMLDivElement | null>(null)
  const activePaneID = useAppStore((state) => state.activePaneId)
  treeRef.current = tree
  primaryRef.current = props.primaryID
  const leaves = useMemo(() => collectLeaves(tree), [tree])
  const paneCount = leaves.length
  const requestFocus = useCallback((terminalID: string) => {
    useAppStore.getState().requestTerminalFocus(props.tabID, terminalID)
  }, [props.tabID])
  const lastUsed = useCallback((terminalID: string) => (
    useAppStore.getState().terminalPool.get(terminalID)?.lastUsed ?? 0
  ), [])
  const { layoutReady, restoreError, retryRestore } = useSplitLayoutRestore({
    tabID: props.tabID, sessionId: props.sessionId, connectionKind: props.connectionKind,
    serialPortId: props.serialPortId, primaryID: props.primaryID,
    operationRef, mountedRef, setTree, setBusy, requestFocus,
  })
  return {
    tree, setTree, busy, setBusy, closingID, setClosingID, actionError, setActionError,
    treeRef, mountedRef, primaryRef, operationRef, hostsRef, stagingRef, activePaneID,
    leaves, paneCount, requestFocus, lastUsed, layoutReady, restoreError, retryRestore,
  }
}

type SplitModel = ReturnType<typeof useSplitModel>

function createSplitActionContext(props: Props, model: SplitModel) {
  return {
    tabID: props.tabID, primaryID: props.primaryID, sessionId: props.sessionId,
    connectionKind: props.connectionKind, serialPortId: props.serialPortId, activePaneID: model.activePaneID,
    treeRef: model.treeRef, primaryRef: model.primaryRef, operationRef: model.operationRef,
    mountedRef: model.mountedRef, setTree: model.setTree, setBusy: model.setBusy,
    setClosingID: model.setClosingID, setActionError: model.setActionError,
    requestFocus: model.requestFocus, lastUsed: model.lastUsed,
    onPaneClosed: props.onPaneClosed, onPaneReplaced: props.onPaneReplaced,
  }
}

function useSplitStateReport(props: Props, model: SplitModel) {
  useEffect(() => { props.onStateChange?.({ paneCount: model.paneCount, busy: model.busy }) }, [model.busy, model.paneCount, props.onStateChange])
}

function useSplitPersistence(props: Props, model: SplitModel) {
  useEffect(() => {
    // Keep the saved multi-pane snapshot until restore succeeds; otherwise retry is impossible.
    if (!model.layoutReady || model.restoreError) return
    persistTabSplitLayout(props.tabID, model.tree, props.primaryID, props.connectionKind)
  }, [model.layoutReady, model.restoreError, model.tree, props.connectionKind, props.primaryID, props.tabID])
}

function useRemoveClosedPane(props: Props, model: SplitModel) {
  return (terminalID: string) => {
    const result = removeTerminal(model.treeRef.current, terminalID, model.lastUsed)
    if (!result) return
    const state = useAppStore.getState()
    const shouldFocus = state.activeSurface?.type === 'terminal' && state.activeSurface.id === props.tabID
    state.forgetTerminal(terminalID)
    model.treeRef.current = result.node
    model.setTree(() => result.node)
    props.onPaneClosed?.(terminalID)
    if (shouldFocus) model.requestFocus(result.focusID)
  }
}

function useClosedPaneListener(tabID: string, closedPaneRef: MutableRefObject<(terminalID: string) => void>) {
  useEffect(() => {
    const onClosed = (event: Event) => {
      const detail = (event as CustomEvent<TerminalClosedSplitPaneDetail>).detail
      if (!detail || detail.tabID !== tabID) return
      closedPaneRef.current(detail.terminalID)
    }
    window.addEventListener(TERMINAL_CLOSED_SPLIT_PANE_EVENT, onClosed)
    return () => window.removeEventListener(TERMINAL_CLOSED_SPLIT_PANE_EVENT, onClosed)
  }, [tabID])
}

function usePrimaryPaneSync(primaryID: string, model: SplitModel) {
  useEffect(() => {
    if (!primaryID) return
    model.setTree((current) => {
      if (hasTerminal(current, primaryID)) return current
      const previousPrimary = model.primaryRef.current
      if (previousPrimary && previousPrimary !== primaryID && hasTerminal(current, previousPrimary)) {
        return replaceTerminal(current, previousPrimary, primaryID)
      }
      const currentLeaves = collectLeaves(current)
      if (currentLeaves.length === 0) return splitLeaf(primaryID)
      return replaceTerminal(current, currentLeaves[0].terminalID, primaryID)
    })
    model.primaryRef.current = primaryID
  }, [primaryID])
}

function useSplitCleanup(model: SplitModel) {
  useEffect(() => () => {
    model.mountedRef.current = false
    for (const terminalID of terminalIDs(model.treeRef.current)) {
      if (terminalID !== model.primaryRef.current) closeSplitTerminalInBackground(terminalID, 'TerminalSplit: cleanup failed')
    }
  }, [])
}

function usePaneHostSync(model: SplitModel) {
  useEffect(() => {
    const hosts = model.hostsRef.current
    const activeLeafIDs = new Set(model.leaves.map((leaf) => leaf.id))
    for (const leaf of model.leaves) ensurePaneHost(hosts, leaf.id, leaf.terminalID)
    for (const [leafID, host] of [...hosts.entries()]) {
      if (activeLeafIDs.has(leafID)) continue
      host.remove()
      hosts.delete(leafID)
    }
  }, [model.leaves])
}

function useRegisterPaneSlot(model: SplitModel) {
  return useCallback((leafID: string, terminalID: string, slot: HTMLDivElement | null) => {
    const host = ensurePaneHost(model.hostsRef.current, leafID, terminalID)
    let moved = false
    if (slot) {
      if (host.parentElement !== slot) {
        slot.appendChild(host)
        moved = true
      }
    } else {
      const staging = model.stagingRef.current
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
}

function useCloseDisconnectedTerminal(props: Props, model: SplitModel, actionCtx: ReturnType<typeof createSplitActionContext>) {
  return (terminalID: string) => {
    if (terminalIDs(model.treeRef.current).length === 1) {
      props.onCloseTerminal?.()
      return
    }
    void closeSplitPane(terminalID, actionCtx)
  }
}

export const TerminalSplit = forwardRef<TerminalSplitHandle, Props>(function TerminalSplit(props, ref) {
  const model = useSplitModel(props)
  const actionCtx = createSplitActionContext(props, model)
  const reconnectPaneRef = useRef<(terminalID: string) => Promise<void>>(async () => {})
  const closedPaneRef = useRef<(terminalID: string) => void>(() => {})
  useSplitAutoReconnect({ tabID: props.tabID, busy: model.busy, treeRef: model.treeRef, operationRef: model.operationRef, mountedRef: model.mountedRef, reconnectRef: reconnectPaneRef })
  useSplitStateReport(props, model)
  useSplitPersistence(props, model)
  useClosedPaneListener(props.tabID, closedPaneRef)
  usePrimaryPaneSync(props.primaryID, model)
  useSplitCleanup(model)
  usePaneHostSync(model)
  const registerSlot = useRegisterPaneSlot(model)
  const removeClosedPane = useRemoveClosedPane(props, model)
  const closeTerminal = useCloseDisconnectedTerminal(props, model, actionCtx)
  useImperativeHandle(ref, () => ({ split: (direction) => { void splitPane(direction, actionCtx) } }))
  reconnectPaneRef.current = (terminalID) => reconnectSplitPane(terminalID, actionCtx)
  closedPaneRef.current = removeClosedPane
  return <TerminalSplitView tree={model.tree} primaryID={props.primaryID} activePaneID={model.activePaneID}
    paneCount={model.paneCount} closingID={model.closingID} restoreError={model.restoreError}
    actionError={model.actionError} busy={model.busy} active={props.active} focusRequest={props.focusRequest}
    hostsRef={model.hostsRef} stagingRef={model.stagingRef} retryRestore={model.retryRestore}
    clearActionError={() => model.setActionError('')} closePane={(id) => { void closeSplitPane(id, actionCtx) }}
    reconnectPane={(id) => { void reconnectSplitPane(id, actionCtx) }} closeTerminal={closeTerminal}
    updateRatio={(id, ratio) => model.setTree((current) => updateSplitRatio(current, id, ratio))}
    registerSlot={registerSlot} />
})
