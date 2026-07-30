import { useCallback, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Clipboard, Play, Save, TextCursorInput } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { t } from '@/i18n'
import type { CommandHistoryEntry } from '@/lib/commandHistory'

interface CommandHistoryRowProps {
  entry: CommandHistoryEntry
  start: number
  height: number
  macroBusy: boolean
  onCopy: (command: string) => Promise<void>
  onExecute: (command: string) => Promise<void>
  onFill: (command: string) => void
  onSaveMacro: (command: string) => void
}

export function CommandHistoryRow({
  entry, start, height, macroBusy, onCopy, onExecute, onFill, onSaveMacro,
}: CommandHistoryRowProps) {
  const commandRef = useRef<HTMLElement>(null)
  const overflow = useCommandOverflow(commandRef, entry.command)
  const row = <div
    className="absolute left-0 right-0 flex items-center gap-1 rounded-lg px-1.5 hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-within:bg-muted/60"
    style={{ top: start, height }}
    tabIndex={overflow ? 0 : -1}
    data-testid="command-history-row"
  >
    <code ref={commandRef} className="min-w-0 flex-1 truncate font-mono text-xs">{entry.command}</code>
    <div className="flex shrink-0 items-center gap-0.5">
      <RowAction label={t('执行')} onClick={() => { void onExecute(entry.command) }}><Play /></RowAction>
      <RowAction label={t('填入终端')} onClick={() => onFill(entry.command)}><TextCursorInput /></RowAction>
      <RowAction label={t('复制')} onClick={() => { void onCopy(entry.command) }}><Clipboard /></RowAction>
      <RowAction label={t('保存为宏')} disabled={macroBusy} onClick={() => onSaveMacro(entry.command)}><Save /></RowAction>
    </div>
  </div>

  return <Tooltip disabled={!overflow}>
    <TooltipTrigger render={row} />
    <TooltipContent className="max-w-md whitespace-pre-wrap break-words font-mono">{entry.command}</TooltipContent>
  </Tooltip>
}

function RowAction({ label, disabled, onClick, children }: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return <Button
    type="button"
    size="icon-xs"
    variant="ghost"
    disabled={disabled}
    aria-label={label}
    title={label}
    onClick={onClick}
  >{children}</Button>
}

function useCommandOverflow(ref: RefObject<HTMLElement | null>, command: string) {
  const [overflow, setOverflow] = useState(false)
  const measure = useCallback(() => {
    const node = ref.current
    setOverflow(Boolean(node && node.scrollWidth > node.clientWidth))
  }, [ref])

  useLayoutEffect(() => {
    measure()
    const node = ref.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [command, measure, ref])

  return overflow
}
