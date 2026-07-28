import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { logger } from '@/lib/logger'
import {
  closeExtraSplitPanes,
  openSplitTerminal,
  readTabSplitLayout,
  restoreSplitTreeFromLayout,
} from '@/components/terminal/splitPersistence'
import { collectLeaves, type SplitNode } from '@/components/terminal/splitTree'
import { t } from '@/i18n'

type Options = {
  tabID: string
  sessionId: number
  connectionKind?: 'ssh' | 'serial' | 'local'
  serialPortId?: number
  primaryID: string
  operationRef: MutableRefObject<boolean>
  mountedRef: MutableRefObject<boolean>
  setTree: Dispatch<SetStateAction<SplitNode>>
  setBusy: Dispatch<SetStateAction<boolean>>
  requestFocus: (terminalID: string) => void
}

export type SplitLayoutRestoreState = {
  layoutReady: boolean
  restoreError: string
  retryRestore: () => void
}

type RestoreRuntime = Omit<Options, 'primaryID'> & {
  primaryRef: MutableRefObject<string>
  restoredOkRef: MutableRefObject<boolean>
  generationRef: MutableRefObject<number>
  setLayoutReady: Dispatch<SetStateAction<boolean>>
  setRestoreError: Dispatch<SetStateAction<string>>
}

function needsLayoutRestore(tabID: string, connectionKind?: Options['connectionKind']) {
  if (connectionKind === 'serial') return false
  const layout = readTabSplitLayout(tabID)
  return Boolean(layout && layout.paneCount > 1)
}

function finishRestore(runtime: RestoreRuntime, generation: number) {
  if (generation !== runtime.generationRef.current) return
  runtime.operationRef.current = false
  if (!runtime.mountedRef.current) return
  runtime.setBusy(false)
  runtime.setLayoutReady(true)
}

async function restoreLayout(runtime: RestoreRuntime, generation: number, isActive: () => boolean) {
  const layout = readTabSplitLayout(runtime.tabID)
  if (!layout) return
  try {
    const restored = await restoreSplitTreeFromLayout(
      layout,
      runtime.primaryRef.current,
      () => openSplitTerminal(
        runtime.sessionId,
        runtime.connectionKind,
        runtime.serialPortId,
        t('串口终端为设备独占，不支持分屏'),
        runtime.primaryRef.current,
      ),
    )
    if (!isActive() || generation !== runtime.generationRef.current || !runtime.mountedRef.current) {
      if (restored) closeExtraSplitPanes(restored.extraTerminalIDs, 'TerminalSplit: cancelled restore cleanup failed')
      return
    }
    if (!restored) return
    runtime.setTree(restored.tree)
    const focusID = collectLeaves(restored.tree)[0]?.terminalID
    if (focusID) runtime.requestFocus(focusID)
    runtime.restoredOkRef.current = true
    runtime.setRestoreError('')
  } catch (error: unknown) {
    logger.error('TerminalSplit: restore layout failed', error)
    if (!isActive() || generation !== runtime.generationRef.current || !runtime.mountedRef.current) return
    runtime.restoredOkRef.current = false
    runtime.setRestoreError(error instanceof Error ? error.message : String(error))
  } finally {
    finishRestore(runtime, generation)
  }
}

function startLayoutRestore(runtime: RestoreRuntime, attempt: number) {
  if (!needsLayoutRestore(runtime.tabID, runtime.connectionKind)) {
    runtime.restoredOkRef.current = true
    runtime.setRestoreError('')
    runtime.setLayoutReady(true)
    return undefined
  }
  if (runtime.restoredOkRef.current && attempt === 0) return undefined
  const generation = ++runtime.generationRef.current
  let active = true
  runtime.operationRef.current = true
  runtime.setLayoutReady(false)
  runtime.setBusy(true)
  runtime.setRestoreError('')
  void restoreLayout(runtime, generation, () => active)
  return () => {
    active = false
    if (generation === runtime.generationRef.current) runtime.operationRef.current = false
  }
}

export function useSplitLayoutRestore(options: Options): SplitLayoutRestoreState {
  const {
    tabID, sessionId, connectionKind, serialPortId, primaryID,
    operationRef, mountedRef, setTree, setBusy, requestFocus,
  } = options
  const initialNeedsRestore = needsLayoutRestore(tabID, connectionKind)
  const [layoutReady, setLayoutReady] = useState(!initialNeedsRestore)
  const [restoreError, setRestoreError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const primaryRef = useRef(primaryID)
  const restoredOkRef = useRef(!initialNeedsRestore)
  const generationRef = useRef(0)
  primaryRef.current = primaryID

  useEffect(() => startLayoutRestore({
    tabID, sessionId, connectionKind, serialPortId, operationRef, mountedRef,
    setTree, setBusy, requestFocus, primaryRef, restoredOkRef, generationRef,
    setLayoutReady, setRestoreError,
  }, attempt), [tabID, connectionKind, sessionId, serialPortId, operationRef, mountedRef, setTree, setBusy, requestFocus, attempt])

  const retryRestore = useCallback(() => {
    if (operationRef.current) return
    restoredOkRef.current = false
    setAttempt((value) => value + 1)
  }, [operationRef])

  return { layoutReady, restoreError, retryRestore }
}
