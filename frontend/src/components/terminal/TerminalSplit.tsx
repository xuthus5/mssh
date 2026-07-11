import { useState, useEffect, useRef } from 'react'
import { X, Columns2, Rows2 } from 'lucide-react'
import { TerminalEmulator } from '@/components/terminal/TerminalEmulator'
import { TerminalService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { useAppStore } from '@/store/appStore'

interface Props {
  primaryID: string
  sessionId: number
  active: boolean
}

export function TerminalSplit({ primaryID, sessionId, active }: Props) {
  const [splitID, setSplitID] = useState<string | null>(null)
  const [direction, setDirection] = useState<'horizontal' | 'vertical'>('horizontal')
  const splitIDRef = useRef<string | null>(null)
  const activePaneID = useAppStore((state) => state.activePaneId)

  useEffect(() => {
    let cancelled = false
    const openSplit = async () => {
      try {
        const id = await TerminalService.Open(sessionId, 80, 24)
        if (cancelled) return
        splitIDRef.current = id
        setSplitID(id)
      } catch (err) {
        logger.error('TerminalSplit: failed to open split', err)
      }
    }
    openSplit()

    return () => {
      cancelled = true
      if (splitIDRef.current) {
        TerminalService.Close(splitIDRef.current).catch(() => {})
      }
    }
  }, [sessionId])

  const handleClose = () => {
    if (splitIDRef.current) {
      TerminalService.Close(splitIDRef.current).catch(() => {})
      splitIDRef.current = null
      setSplitID(null)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 h-8 px-2 bg-muted/30 border-b flex-shrink-0">
        <span className="text-xs text-muted-foreground">分屏</span>
        <div className="flex items-center gap-0.5 ml-auto">
          <button
            type="button"
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs transition-colors ${
              direction === 'horizontal'
                ? 'bg-primary/20 text-primary'
                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
            }`}
            onClick={() => setDirection('horizontal')}
            title="水平分屏"
          >
            <Columns2 className="h-3 w-3" />
          </button>
          <button
            type="button"
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs transition-colors ${
              direction === 'vertical'
                ? 'bg-primary/20 text-primary'
                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
            }`}
            onClick={() => setDirection('vertical')}
            title="垂直分屏"
          >
            <Rows2 className="h-3 w-3" />
          </button>
          {splitID && (
            <button
              type="button"
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-muted-foreground hover:bg-muted/50 hover:text-destructive transition-colors"
              onClick={handleClose}
              title="关闭分屏"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
      <div
        className="flex-1 flex min-h-0"
        style={{ flexDirection: direction === 'horizontal' ? 'row' : 'column' }}
      >
        <div className="flex-1 min-h-0 min-w-0 border-r border-border/50">
          <TerminalEmulator terminalID={primaryID} active={active && activePaneID !== splitID} />
        </div>
        {splitID && (
          <div className="flex-1 min-h-0 min-w-0">
            <TerminalEmulator terminalID={splitID} active={active && activePaneID === splitID} />
          </div>
        )}
      </div>
    </div>
  )
}
