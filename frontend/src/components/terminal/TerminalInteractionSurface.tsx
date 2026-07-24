import { useState, type ReactNode, type RefObject } from 'react'
import type { Terminal } from '@xterm/xterm'
import { ClipboardPaste, Copy, TextSelect } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { logger } from '@/lib/logger'
import {
  copyTerminalSelection,
  pasteClipboardIntoTerminal,
  selectAllTerminal,
} from '@/lib/terminalInteractions'
import { useTerminalBehaviorStore } from '@/store/terminalBehaviorStore'
import { t } from '@/i18n'
import { reportTerminalClipboardError } from '@/lib/terminalClipboardEvents'


interface TerminalInteractionSurfaceProps {
  terminalRef: RefObject<Terminal | null>
  terminalID?: string
  children: ReactNode
}

interface TerminalClipboardActions {
  copy: () => Promise<void>
  paste: () => Promise<void>
  selectAll: () => void
}

interface TerminalContextMenuProps extends TerminalInteractionSurfaceProps {
  actions: TerminalClipboardActions
  pasteMode: boolean
}

function reportExplicitClipboardError(error: unknown, terminalID?: string) {
  logger.error('terminal clipboard action failed', error)
  // Toolbar banner owns fixed-surface clipboard failures for the active terminal.
  reportTerminalClipboardError(
    t('剪贴板操作失败: ${}', error instanceof Error ? error.message : String(error)),
    terminalID,
  )
}

function restoreTerminalFocus(term: Terminal) {
  try {
    term.focus()
  } catch (error: unknown) {
    logger.error('terminal focus restore failed', error)
  }
}

function useTerminalClipboardActions(terminalRef: RefObject<Terminal | null>): TerminalClipboardActions {
  const copy = async () => {
    const term = terminalRef.current
    if (!term) return
    try {
      await copyTerminalSelection(term)
    } finally {
      restoreTerminalFocus(term)
    }
  }
  const paste = async () => {
    const term = terminalRef.current
    if (!term) return
    try {
      await pasteClipboardIntoTerminal(term)
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

  return { copy, paste, selectAll }
}

function TerminalContextMenu({ terminalRef, terminalID, children, actions, pasteMode }: TerminalContextMenuProps) {
  const [copyDisabled, setCopyDisabled] = useState(true)
  const report = (error: unknown) => reportExplicitClipboardError(error, terminalID)
  return (
    <ContextMenu disabled={pasteMode}>
      <ContextMenuTrigger
        className="flex h-full min-h-0 min-w-0 w-full select-text bg-background text-foreground"
        onContextMenuCapture={(event) => {
          if (pasteMode) {
            event.preventDefault()
            void actions.paste().catch(report)
            return
          }
          setCopyDisabled(!terminalRef.current?.getSelection())
        }}
      >
        {children}
      </ContextMenuTrigger>
      {!pasteMode && (
        <ContextMenuContent>
          <ContextMenuItem disabled={copyDisabled} onClick={() => { void actions.copy().catch(report) }}>
            <Copy />
            {t('复制')}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => { void actions.paste().catch(report) }}>
            <ClipboardPaste />
            {t('粘贴')}
          </ContextMenuItem>
          <ContextMenuItem onClick={actions.selectAll}>
            <TextSelect />
            {t('全选')}
          </ContextMenuItem>
        </ContextMenuContent>
      )}
    </ContextMenu>
  )
}

export function TerminalInteractionSurface({ terminalRef, terminalID, children }: TerminalInteractionSurfaceProps) {
  const rightClickAction = useTerminalBehaviorStore((state) => state.rightClickAction)
  const actions = useTerminalClipboardActions(terminalRef)

  return (
    <TerminalContextMenu terminalRef={terminalRef} terminalID={terminalID} actions={actions} pasteMode={rightClickAction === 'paste'}>
      {children}
    </TerminalContextMenu>
  )
}
