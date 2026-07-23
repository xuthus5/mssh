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

export function useSplitLayoutRestore(options: Options): SplitLayoutRestoreState {
  const {
    tabID, sessionId, connectionKind, serialPortId, primaryID,
    operationRef, mountedRef, setTree, setBusy, requestFocus,
  } = options
  const initialNeedsRestore = connectionKind !== 'serial' && (() => {
    const layout = readTabSplitLayout(tabID)
    return Boolean(layout && layout.paneCount > 1)
  })()
  const [layoutReady, setLayoutReady] = useState(!initialNeedsRestore)
  const [restoreError, setRestoreError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const primaryRef = useRef(primaryID)
  const restoredOkRef = useRef(!initialNeedsRestore)
  const generationRef = useRef(0)
  primaryRef.current = primaryID

  useEffect(() => {
    if (connectionKind === 'serial') {
      restoredOkRef.current = true
      setRestoreError('')
      setLayoutReady(true)
      return
    }
    const layout = readTabSplitLayout(tabID)
    if (!layout || layout.paneCount < 2) {
      restoredOkRef.current = true
      setRestoreError('')
      setLayoutReady(true)
      return
    }
    if (restoredOkRef.current && attempt === 0) return

    const generation = ++generationRef.current
    let active = true
    operationRef.current = true
    setLayoutReady(false)
    setBusy(true)
    setRestoreError('')

    void (async () => {
      try {
        const restored = await restoreSplitTreeFromLayout(
          layout,
          primaryRef.current,
          () => openSplitTerminal(sessionId, connectionKind, serialPortId, t('串口终端为设备独占，不支持分屏'), primaryRef.current),
        )
        if (!active || generation !== generationRef.current) {
          if (restored) closeExtraSplitPanes(restored.extraTerminalIDs, 'TerminalSplit: cancelled restore cleanup failed')
          return
        }
        if (!restored) return
        if (!mountedRef.current) {
          closeExtraSplitPanes(restored.extraTerminalIDs, 'TerminalSplit: cancelled restore cleanup failed')
          return
        }
        setTree(restored.tree)
        const focusID = collectLeaves(restored.tree)[0]?.terminalID
        if (focusID) requestFocus(focusID)
        restoredOkRef.current = true
        setRestoreError('')
      } catch (error: unknown) {
        logger.error('TerminalSplit: restore layout failed', error)
        if (!active || generation !== generationRef.current || !mountedRef.current) return
        restoredOkRef.current = false
        setRestoreError(error instanceof Error ? error.message : String(error))
      } finally {
        if (generation === generationRef.current) {
          operationRef.current = false
          if (mountedRef.current) {
            setBusy(false)
            setLayoutReady(true)
          }
        }
      }
    })()

    return () => {
      active = false
      // Allow a remounted effect (React Strict Mode) to start a fresh restore.
      if (generation === generationRef.current) operationRef.current = false
    }
  }, [tabID, connectionKind, sessionId, serialPortId, operationRef, mountedRef, setTree, setBusy, requestFocus, attempt])

  const retryRestore = useCallback(() => {
    if (operationRef.current) return
    restoredOkRef.current = false
    setAttempt((value) => value + 1)
  }, [operationRef])

  return { layoutReady, restoreError, retryRestore }
}
