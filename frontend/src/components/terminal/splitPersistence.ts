import { TerminalService } from '@/lib/wails'
import { useAppStore } from '@/store/appStore'
import { openTerminalWithPoolCapacity } from '@/lib/openTerminal'
import {
  materializeSplitLayout,
  serializeSplitLayout,
  type SplitLayoutSnapshot,
} from '@/components/terminal/splitLayout'
import { splitLeaf, terminalIDs, type SplitNode } from '@/components/terminal/splitTree'
import { logger } from '@/lib/logger'
import { resolveOpenTerminalSize } from '@/lib/terminalOpenSize'

export function readTabSplitLayout(tabID: string): SplitLayoutSnapshot | null {
  const tab = useAppStore.getState().tabs.find((item) => item.id === tabID && item.type === 'terminal')
  if (!tab || tab.type !== 'terminal') return null
  return tab.splitLayout ?? null
}

export function persistTabSplitLayout(tabID: string, tree: SplitNode, primaryID: string, connectionKind?: string) {
  const paneIDs = terminalIDs(tree)
  if (connectionKind === 'serial') {
    useAppStore.getState().updateTerminalWorkspace(tabID, { splitLayout: null, splitPaneIDs: paneIDs })
    return
  }
  const snapshot = serializeSplitLayout(tree, primaryID)
  useAppStore.getState().updateTerminalWorkspace(tabID, { splitLayout: snapshot, splitPaneIDs: paneIDs })
}

type OpenFn = () => Promise<string>

export function closeExtraSplitPanes(terminalIDs: string[], context: string): void {
  for (const id of terminalIDs) {
    void TerminalService.Close(id).catch((closeErr: unknown) => {
      logger.error(context, closeErr)
    })
  }
}

export async function openExtraSplitPanes(
  count: number,
  openOne: OpenFn,
): Promise<string[]> {
  const ids: string[] = []
  try {
    for (let i = 0; i < count; i++) {
      const id = await openTerminalWithPoolCapacity(openOne)
      ids.push(id)
      useAppStore.getState().setConnectionStatus(id, 'connected')
    }
    return ids
  } catch (error) {
    closeExtraSplitPanes(ids, 'split restore cleanup failed')
    throw error
  }
}

export type RestoredSplitLayout = {
  tree: SplitNode
  /** Secondary terminal IDs opened during restore; callers must close these if they discard the tree. */
  extraTerminalIDs: string[]
}

export async function restoreSplitTreeFromLayout(
  layout: SplitLayoutSnapshot,
  primaryID: string,
  openOne: OpenFn,
): Promise<RestoredSplitLayout | null> {
  if (!layout || layout.paneCount < 2) return null
  const extra = layout.paneCount - 1
  const extras = await openExtraSplitPanes(extra, openOne)
  const terminalIDs = [primaryID, ...extras]
  const tree = materializeSplitLayout(layout, terminalIDs)
  if (!tree) {
    closeExtraSplitPanes(extras, 'split restore materialize cleanup failed')
    return null
  }
  return { tree, extraTerminalIDs: extras }
}


export function initialSplitTree(primaryID: string): SplitNode {
  return splitLeaf(primaryID)
}

export function openSplitTerminal(
  sessionId: number,
  connectionKind: 'ssh' | 'serial' | 'local' | undefined,
  serialPortId: number | undefined,
  serialBlockedMessage: string,
  preferredTerminalID?: string | null,
): Promise<string> {
  const size = resolveOpenTerminalSize(preferredTerminalID)
  if (connectionKind === 'local') return TerminalService.OpenLocal(size.cols, size.rows)
  if (connectionKind === 'serial') throw new Error(serialBlockedMessage)
  return TerminalService.Open(sessionId, size.cols, size.rows)
}

export function closeInBackground(terminalID: string, context: string, isNotFound: (error: unknown) => boolean) {
  void TerminalService.Close(terminalID).catch((error: unknown) => {
    if (!isNotFound(error)) logger.error(context, error)
  })
}

export function replaceSecondaryTerminalRuntime(previousID: string, nextID: string) {
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
    return {
      terminalPool,
      connectionStatus,
      recordingState,
      activePaneId: state.activePaneId === previousID ? nextID : state.activePaneId,
    }
  })
}

export function ensurePaneHost(hosts: Map<string, HTMLDivElement>, leafID: string, terminalID: string): HTMLDivElement {
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
