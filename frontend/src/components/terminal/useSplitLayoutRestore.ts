import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
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

export function useSplitLayoutRestore(options: Options): boolean {
  const {
    tabID, sessionId, connectionKind, serialPortId, primaryID,
    operationRef, mountedRef, setTree, setBusy, requestFocus,
  } = options
  const initialNeedsRestore = connectionKind !== 'serial' && (() => {
    const layout = readTabSplitLayout(tabID)
    return Boolean(layout && layout.paneCount > 1)
  })()
  const [layoutReady, setLayoutReady] = useState(!initialNeedsRestore)
  const layoutReadyRef = useRef(!initialNeedsRestore)
  const primaryRef = useRef(primaryID)
  primaryRef.current = primaryID

  useEffect(() => {
    if (layoutReadyRef.current) return
    const markReady = () => {
      layoutReadyRef.current = true
      setLayoutReady(true)
    }
    if (connectionKind === 'serial') {
      markReady()
      return
    }
    const layout = readTabSplitLayout(tabID)
    if (!layout || layout.paneCount < 2) {
      markReady()
      return
    }
    let cancelled = false
    void (async () => {
      if (operationRef.current) {
        markReady()
        return
      }
      operationRef.current = true
      setBusy(true)
      try {
        const restored = await restoreSplitTreeFromLayout(
          layout,
          primaryRef.current,
          () => openSplitTerminal(sessionId, connectionKind, serialPortId, t('串口终端为设备独占，不支持分屏'), primaryRef.current),
        )
        if (!restored) return
        if (cancelled || !mountedRef.current) {
          closeExtraSplitPanes(restored.extraTerminalIDs, 'TerminalSplit: cancelled restore cleanup failed')
          return
        }
        setTree(restored.tree)
        const focusID = collectLeaves(restored.tree)[0]?.terminalID
        if (focusID) requestFocus(focusID)
      } catch (error: unknown) {
        logger.error('TerminalSplit: restore layout failed', error)
      } finally {
        operationRef.current = false
        if (mountedRef.current) {
          setBusy(false)
          markReady()
        }
      }
    })()
    return () => { cancelled = true }
  }, [tabID, connectionKind, sessionId, serialPortId, operationRef, mountedRef, setTree, setBusy, requestFocus])

  return layoutReady
}
