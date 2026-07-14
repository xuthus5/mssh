import { useState, type MouseEvent, type ReactNode, type RefObject } from 'react'
import type { Terminal } from '@xterm/xterm'
import { ClipboardPaste, Copy, TextSelect } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { toast } from '@/components/ui/toast'
import { logger } from '@/lib/logger'
import {
  copyTerminalSelection,
  pasteClipboardIntoTerminal,
  selectAllTerminal,
} from '@/lib/terminalInteractions'
import { useTerminalBehaviorStore } from '@/store/terminalBehaviorStore'

interface TerminalInteractionSurfaceProps {
  terminalRef: RefObject<Terminal | null>
  children: ReactNode
}

function reportExplicitClipboardError(error: unknown) {
  logger.error('terminal clipboard action failed', error)
  toast(`剪贴板操作失败: ${error instanceof Error ? error.message : String(error)}`, 'error')
}

function restoreTerminalFocus(term: Terminal) {
  try {
    term.focus()
  } catch (error: unknown) {
    logger.error('terminal focus restore failed', error)
  }
}

export function TerminalInteractionSurface({ terminalRef, children }: TerminalInteractionSurfaceProps) {
  const rightClickAction = useTerminalBehaviorStore((state) => state.rightClickAction)
  const [copyDisabled, setCopyDisabled] = useState(true)
  const copy = async () => {
    const term = terminalRef.current
    if (!term) return
    try {
      await copyTerminalSelection(term, navigator.clipboard)
    } finally {
      restoreTerminalFocus(term)
    }
  }
  const paste = async () => {
    const term = terminalRef.current
    if (!term) return
    try {
      await pasteClipboardIntoTerminal(term, navigator.clipboard)
    } finally {
      restoreTerminalFocus(term)
    }
  }
  const selectAll = () => {
    const term = terminalRef.current
    if (!term) return
    try {
      selectAllTerminal(term)
    } finally {
      restoreTerminalFocus(term)
    }
  }

  if (rightClickAction === 'paste') {
    return (
      <div
        className="h-full w-full select-text bg-background text-foreground"
        onContextMenu={(event: MouseEvent<HTMLDivElement>) => {
          event.preventDefault()
          void paste().catch(reportExplicitClipboardError)
        }}
      >
        {children}
      </div>
    )
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        className="h-full w-full select-text bg-background text-foreground"
        onContextMenuCapture={() => setCopyDisabled(!terminalRef.current?.getSelection())}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem disabled={copyDisabled} onClick={() => { void copy().catch(reportExplicitClipboardError) }}>
          <Copy />
          复制
        </ContextMenuItem>
        <ContextMenuItem onClick={() => { void paste().catch(reportExplicitClipboardError) }}>
          <ClipboardPaste />
          粘贴
        </ContextMenuItem>
        <ContextMenuItem onClick={selectAll}>
          <TextSelect />
          全选
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
