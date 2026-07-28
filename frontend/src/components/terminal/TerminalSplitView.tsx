import { createPortal } from 'react-dom'
import type { MutableRefObject } from 'react'
import { TerminalEmulator } from '@/components/terminal/TerminalEmulator'
import { SplitTreeView } from '@/components/terminal/TerminalSplitLayout'
import { ensurePaneHost } from '@/components/terminal/splitPersistence'
import type { TerminalFocusRequest } from '@/hooks/useTerminal'
import { collectLeaves, type SplitNode } from '@/components/terminal/splitTree'
import { t } from '@/i18n'

const noFocusRequest: TerminalFocusRequest = { sequence: 0, targetTerminalID: null }

interface TerminalSplitViewProps {
  tree: SplitNode
  primaryID: string
  activePaneID: string | null
  paneCount: number
  closingID: string | null
  restoreError: string
  actionError: string
  busy: boolean
  active: boolean
  focusRequest: TerminalFocusRequest
  hostsRef: MutableRefObject<Map<string, HTMLDivElement>>
  stagingRef: MutableRefObject<HTMLDivElement | null>
  retryRestore: () => void
  clearActionError: () => void
  closePane: (terminalID: string) => void
  reconnectPane: (terminalID: string) => void
  closeTerminal: (terminalID: string) => void
  updateRatio: (nodeID: string, ratio: number) => void
  registerSlot: (leafID: string, terminalID: string, slot: HTMLDivElement | null) => void
}

function SplitAlerts(props: Pick<TerminalSplitViewProps, 'restoreError' | 'actionError' | 'busy' | 'retryRestore' | 'clearActionError'>) {
  return <>
    {props.restoreError ? (
      <div role="alert" className="z-20 flex shrink-0 items-center justify-between gap-2 border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
        <span className="min-w-0 truncate">{t('恢复分屏布局失败: ${}', props.restoreError)}</span>
        <button type="button" aria-label={t('重试')} className="shrink-0 rounded-md border border-border bg-background px-2 py-0.5 text-foreground hover:bg-muted" onClick={props.retryRestore} disabled={props.busy}>{t('重试')}</button>
      </div>
    ) : null}
    {props.actionError ? (
      <div role="alert" className="z-20 flex shrink-0 items-center justify-between gap-2 border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
        <span className="min-w-0 truncate">{props.actionError}</span>
        <button type="button" aria-label={t('关闭')} className="shrink-0 rounded-md border border-border bg-background px-2 py-0.5 text-foreground hover:bg-muted" onClick={props.clearActionError}>{t('关闭')}</button>
      </div>
    ) : null}
  </>
}

function SplitTerminalPortals(props: Pick<TerminalSplitViewProps, 'tree' | 'primaryID' | 'activePaneID' | 'active' | 'focusRequest' | 'hostsRef'>) {
  return collectLeaves(props.tree).map((leaf) => {
    const host = ensurePaneHost(props.hostsRef.current, leaf.id, leaf.terminalID)
    const selected = props.activePaneID ? props.activePaneID === leaf.terminalID : props.primaryID === leaf.terminalID
    const request = props.focusRequest.targetTerminalID === leaf.terminalID ? props.focusRequest : noFocusRequest
    return createPortal(
      <TerminalEmulator key={leaf.id} terminalID={leaf.terminalID} active={props.active && selected}
        focusRequest={request} className="h-full w-full min-h-0 min-w-0" />,
      host,
      leaf.id,
    )
  })
}

export function TerminalSplitView(props: TerminalSplitViewProps) {
  return <div className="relative flex h-full w-full min-h-0 min-w-0 flex-1 flex-col">
    <SplitAlerts {...props} />
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <div ref={props.stagingRef} className="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0" aria-hidden="true" />
      <SplitTreeView node={props.tree} primaryID={props.primaryID} activePaneID={props.activePaneID}
        paneCount={props.paneCount} closingID={props.closingID} onClose={props.closePane}
        onReconnect={props.reconnectPane} onCloseTerminal={props.closeTerminal}
        onRatio={props.updateRatio} registerHost={props.registerSlot} />
      <SplitTerminalPortals {...props} />
    </div>
  </div>
}
