import { useState, type ReactNode, type RefObject } from 'react'
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
import { t } from '@/i18n'


interface TerminalInteractionSurfaceProps {
  terminalRef: RefObject<Terminal | null>
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

function reportExplicitClipboardError(error: unknown) {
  logger.error('terminal clipboard action failed', error)
  toast(t('剪贴板操作失败: ${}', error instanceof Error ? error.message : String(error)), 'error')
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

function TerminalContextMenu({ terminalRef, children, actions, pasteMode }: TerminalContextMenuProps) {
  const [copyDisabled, setCopyDisabled] = useState(true)
  return (
    <ContextMenu disabled={pasteMode}>
      <ContextMenuTrigger
        className="flex h-full min-h-0 min-w-0 w-full select-text bg-background text-foreground"
        onContextMenuCapture={(event) => {
          if (pasteMode) {
            event.preventDefault()
            void actions.paste().catch(reportExplicitClipboardError)
            return
          }
          setCopyDisabled(!terminalRef.current?.getSelection())
        }}
      >
        {children}
      </ContextMenuTrigger>
      {!pasteMode && (
        <ContextMenuContent>
          <ContextMenuItem disabled={copyDisabled} onClick={() => { void actions.copy().catch(reportExplicitClipboardError) }}>
            <Copy />
            {t('复制')}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => { void actions.paste().catch(reportExplicitClipboardError) }}>
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

export function TerminalInteractionSurface({ terminalRef, children }: TerminalInteractionSurfaceProps) {
  const rightClickAction = useTerminalBehaviorStore((state) => state.rightClickAction)
  const actions = useTerminalClipboardActions(terminalRef)

  return (
    <TerminalContextMenu terminalRef={terminalRef} actions={actions} pasteMode={rightClickAction === 'paste'}>
      {children}
    </TerminalContextMenu>
  )
}
