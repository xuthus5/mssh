import type { ReactNode } from 'react'
import { RefreshCw, WifiOff, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store/appStore'
import {
  type SplitBranch,
  type SplitNode,
} from '@/components/terminal/splitTree'
import { t } from '@/i18n'

export interface SplitTreeViewProps {
  node: SplitNode
  primaryID: string
  activePaneID: string | null
  paneCount: number
  closingID: string | null
  onClose: (terminalID: string) => void
  onReconnect: (terminalID: string) => void
  onCloseTerminal: (terminalID: string) => void
  onRatio: (branchID: string, ratio: number) => void
  registerHost: (leafID: string, terminalID: string, element: HTMLDivElement | null) => void
}

function ConnectionOverlay({ terminalID, onReconnect, onClose }: { terminalID: string; onReconnect: () => void; onClose: () => void }) {
  const status = useAppStore((state) => state.connectionStatus[terminalID])
  if (status === undefined || status === 'connected') return null
  const connecting = status === 'connecting' || status === 'reconnecting'
  const title = connecting ? t('正在重新连接') : status === 'error' ? t('连接异常') : t('连接已断开')
  const description = connecting
    ? t('正在为当前终端创建新的连接通道。')
    : status === 'error'
      ? t('终端通道不可用（挂载或通信失败），可在当前终端中重新连接。')
      : t('会话可能因空闲超时、进程退出或网络中断而结束，可在当前终端中重新连接。')
  return <div role="alert" aria-live="polite" className="absolute inset-0 z-10 grid place-items-center bg-background/70 p-6 backdrop-blur-[1px]">
    <div className="flex w-full max-w-sm flex-col items-center rounded-xl border border-border bg-card/95 p-5 text-center shadow-lg">
      {connecting ? <RefreshCw aria-hidden="true" className="mb-3 size-8 animate-spin text-primary" /> : <WifiOff aria-hidden="true" className="mb-3 size-8 text-destructive" />}
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      <div className="mt-4 flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={connecting} onClick={onClose}><X />{t('关闭终端')}</Button>
        <Button type="button" size="sm" disabled={connecting} onClick={onReconnect}><RefreshCw />{connecting ? t('正在重连') : t('重新连接')}</Button>
      </div>
    </div>
  </div>
}

function LeafView(props: SplitTreeViewProps & { node: Extract<SplitNode, { kind: 'leaf' }> }) {
  const terminalID = props.node.terminalID
  const selected = props.activePaneID ? props.activePaneID === terminalID : props.primaryID === terminalID
  return <div className={`group relative h-full w-full min-h-0 min-w-0 flex-1 overflow-hidden ${selected ? 'ring-1 ring-inset ring-primary/35' : ''}`}>
    <div
      data-testid={`pane-slot-${terminalID}`}
      className="h-full w-full min-h-0 min-w-0"
      ref={(element) => props.registerHost(props.node.id, terminalID, element)}
    />
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

export function SplitTreeView(props: SplitTreeViewProps): ReactNode {
  if (props.node.kind === 'leaf') return <LeafView {...props} node={props.node} />
  const horizontal = props.node.direction === 'horizontal'
  return <div className={`flex min-h-0 min-w-0 flex-1 ${horizontal ? 'flex-row' : 'flex-col'}`}>
    <div className="flex min-h-0 min-w-0 overflow-hidden" style={{ flexBasis: `${props.node.ratio}%`, flexGrow: 0, flexShrink: 0 }}>
      <SplitTreeView {...props} node={props.node.first} />
    </div>
    <Divider branch={props.node} onRatio={props.onRatio} />
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <SplitTreeView {...props} node={props.node.second} />
    </div>
  </div>
}
