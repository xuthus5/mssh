import { cn } from '@/lib/utils'

export interface TerminalSuggestionOverlayProps {
  inline: string
  candidates: string[]
  selectedIndex: number
  leftOffset: number
  showAbove: boolean
  onSelect: (index: number) => void
}

/** Ghost-text inline suggestion plus an optional selectable candidate list. */
export function TerminalSuggestionOverlay({
  inline,
  candidates,
  selectedIndex,
  leftOffset,
  showAbove,
  onSelect,
}: TerminalSuggestionOverlayProps) {
  return (
    <div className="relative overflow-visible">
      {inline && (
        <span
          className="pointer-events-none absolute top-0 whitespace-pre text-muted-foreground/60"
          style={{ left: leftOffset }}
        >
          {inline}
        </span>
      )}
      {candidates.length > 0 && (
        <div
          className={cn(
            'absolute z-20 min-w-56 max-w-80 rounded-xl border border-border bg-card py-1 shadow-sm',
            showAbove ? 'bottom-full mb-1' : 'top-full mt-1',
          )}
          style={{ left: leftOffset }}
        >
          {candidates.map((candidate, index) => (
            <button
              key={candidate}
              type="button"
              className={cn(
                'block w-full truncate px-2.5 py-1 text-left text-xs text-foreground',
                index === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
              )}
              onMouseDown={(event) => {
                event.preventDefault()
                onSelect(index)
              }}
            >
              {candidate}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
