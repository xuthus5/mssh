import { createPortal } from 'react-dom'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { TerminalEmulator } from '@/components/terminal/TerminalEmulator'
import { SplitTreeView } from '@/components/terminal/TerminalSplitLayout'
import type { TerminalFocusRequest } from '@/hooks/useTerminal'
import { useAppStore } from '@/store/appStore'
import {
  collectLeaves,
  hasTerminal,
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
import { t } from '@/i18n'
import { useSplitLayoutRestore } from '@/components/terminal/useSplitLayoutRestore'
import { RECONNECT_SPLIT_PANE_EVENT, type ReconnectSplitPaneDetail } from '@/hooks/sessionReconnect'
import {
  closeSplitPane,
  closeSplitTerminalInBackground,
  reconnectSplitPane,
  splitPane,
} from '@/components/terminal/terminalSplitActions'

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
  const { layoutReady, restoreError, retryRestore } = useSplitLayoutRestore({
    tabID, sessionId, connectionKind, serialPortId, primaryID,
    operationRef, mountedRef, setTree, setBusy, requestFocus,
  })
  const actionCtx = {
    tabID, primaryID, sessionId, connectionKind, serialPortId, activePaneID,
    treeRef, primaryRef, operationRef, mountedRef, setTree, setBusy, setClosingID,
    requestFocus, lastUsed, onPaneClosed, onPaneReplaced,
  }

  useEffect(() => { onStateChange?.({ paneCount, busy }) }, [busy, onStateChange, paneCount])

  useEffect(() => {
    // Keep the saved multi-pane snapshot until restore succeeds; otherwise retry is impossible.
    if (!layoutReady || restoreError) return
    persistTabSplitLayout(tabID, tree, primaryID, connectionKind)
  }, [tabID, tree, primaryID, connectionKind, layoutReady, restoreError])

  const reconnectPaneRef = useRef<(terminalID: string) => Promise<void>>(async () => {})

  useEffect(() => {
    const onReconnectSplit = (event: Event) => {
      const detail = (event as CustomEvent<ReconnectSplitPaneDetail>).detail
      if (!detail || detail.tabID !== tabID) return
      if (!hasTerminal(treeRef.current, detail.terminalID)) return
      void reconnectPaneRef.current(detail.terminalID)
    }
    window.addEventListener(RECONNECT_SPLIT_PANE_EVENT, onReconnectSplit)
    return () => window.removeEventListener(RECONNECT_SPLIT_PANE_EVENT, onReconnectSplit)
  }, [tabID])

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
      if (terminalID !== primaryRef.current) closeSplitTerminalInBackground(terminalID, 'TerminalSplit: cleanup failed')
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

  useImperativeHandle(ref, () => ({
    split: (direction) => { void splitPane(direction, actionCtx) },
  }))

  reconnectPaneRef.current = (terminalID) => reconnectSplitPane(terminalID, actionCtx)

  const closeDisconnectedTerminal = (terminalID: string) => {
    if (terminalIDs(treeRef.current).length === 1) {
      onCloseTerminal?.()
      return
    }
    void closeSplitPane(terminalID, actionCtx)
  }

  return <div className="relative flex h-full w-full min-h-0 min-w-0 flex-1 flex-col">
    {restoreError ? (
      <div role="alert" className="z-20 flex shrink-0 items-center justify-between gap-2 border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
        <span className="min-w-0 truncate">{t('恢复分屏布局失败: ${}', restoreError)}</span>
        <button type="button" aria-label={t('重试')} className="shrink-0 rounded-md border border-border bg-background px-2 py-0.5 text-foreground hover:bg-muted" onClick={retryRestore} disabled={busy}>
          {t('重试')}
        </button>
      </div>
    ) : null}
    <div className="relative flex min-h-0 min-w-0 flex-1">
    <div ref={stagingRef} className="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0" aria-hidden="true" />
    <SplitTreeView
      node={tree}
      primaryID={primaryID}
      activePaneID={activePaneID}
      paneCount={paneCount}
      closingID={closingID}
      onClose={(id) => { void closeSplitPane(id, actionCtx) }}
      onReconnect={(id) => { void reconnectSplitPane(id, actionCtx) }}
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
  </div>
})
