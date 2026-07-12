import { useRef, useEffect, useState, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Play, Pause } from 'lucide-react'
import { LogService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { useAppStore } from '@/store/appStore'
import { applyTerminalTheme, xtermTheme } from '@/lib/terminalTheme'

interface RecordingEntry {
  timestamp: number
  type: number
  data: number[]
}

interface PlayerData {
  cols: number
  rows: number
  term_type: string
  entries: RecordingEntry[]
}

interface Props {
  recordingId: string
  title: string
}

export function PlaybackTab({ recordingId, title }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [progress, setProgress] = useState(0)
  const [entries, setEntries] = useState<RecordingEntry[]>([])
  const speedRef = useRef(1)
  const playbackRef = useRef<{ timer: ReturnType<typeof setInterval> | null; index: number; position: number; lastTick: number }>({
    timer: null,
    index: 0,
    position: 0,
    lastTick: 0,
  })

  useEffect(() => {
    let disposed = false
    const terminalTheme = useAppStore.getState().terminalTheme

    const term = new Terminal({
      cursorBlink: false,
      disableStdin: true,
      fontSize: terminalTheme.fontSize,
      fontFamily: terminalTheme.fontFamily,
      theme: xtermTheme(terminalTheme),
      scrollback: 10000,
    })
    termRef.current = term
    const unsubscribeTheme = useAppStore.subscribe((state, previous) => {
      if (state.terminalTheme !== previous.terminalTheme) applyTerminalTheme(term.options, state.terminalTheme)
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    if (containerRef.current) {
      term.open(containerRef.current)
      fitAddon.fit()
    }

    const resizeObs = new ResizeObserver(() => {
      if (containerRef.current) {
        fitAddon.fit()
      }
    })
    if (containerRef.current) {
      resizeObs.observe(containerRef.current)
    }

    LogService.GetRecording(String(recordingId)).then((data) => {
      if (disposed) return
      const player = data as PlayerData | null
      if (player?.entries) {
        setEntries(player.entries)
        term.writeln(`\x1b[1;36mRecording: ${title}\x1b[0m`)
        term.writeln(`\x1b[90m${player.entries.length} entries ready for playback\x1b[0m`)
      } else {
        term.writeln('\x1b[33mNo recording data found\x1b[0m')
      }
    }).catch((err: unknown) => {
      if (disposed) return
      logger.error('PlaybackTab: GetRecording error:', err)
      term.writeln('\x1b[31mFailed to load recording\x1b[0m')
    })

    return () => {
      disposed = true
      const p = playbackRef.current
      if (p.timer) {
        clearInterval(p.timer)
      }
      resizeObs.disconnect()
      unsubscribeTheme()
      term.dispose()
    }
  }, [recordingId, title])

  const togglePlay = useCallback(() => {
    if (entries.length === 0) return

    const next = !playing
    setPlaying(next)

    const p = playbackRef.current
    const term = termRef.current
    if (!term) return

    if (next) {
      p.lastTick = Date.now()
      p.timer = setInterval(() => {
        const now = Date.now()
        p.position += (now - p.lastTick) * speedRef.current
        p.lastTick = now
        let newIndex = p.index

        while (newIndex < entries.length && entries[newIndex].timestamp <= p.position) {
          const entry = entries[newIndex]
          if (entry.data && entry.data.length > 0) {
            term.write(new Uint8Array(entry.data))
          }
          newIndex++
        }

        p.index = newIndex
        const duration = entries.at(-1)?.timestamp ?? 0
        const pct = duration > 0 ? Math.min(100, Math.round((p.position / duration) * 100)) : 0
        setProgress(pct)

        if (newIndex >= entries.length) {
          clearInterval(p.timer!)
          p.timer = null
          setPlaying(false)
        }
      }, 16)
    } else {
      if (p.timer) {
        clearInterval(p.timer)
        p.timer = null
      }
    }
  }, [playing, entries])

  const handleSpeedChange = useCallback((value: number | number[]) => {
    const v = typeof value === 'number' ? value : value[0]
    setSpeed(v)
    speedRef.current = v
  }, [])

  const seek = useCallback((percentage: number) => {
    const term = termRef.current
    if (!term || entries.length === 0) return
    const duration = entries.at(-1)?.timestamp ?? 0
    const position = duration * Math.max(0, Math.min(100, percentage)) / 100
    const p = playbackRef.current
    term.reset()
    let index = 0
    while (index < entries.length && entries[index].timestamp <= position) {
      const entry = entries[index]
      if (entry.data?.length) term.write(new Uint8Array(entry.data))
      index++
    }
    p.index = index
    p.position = position
    p.lastTick = Date.now()
    setProgress(percentage)
  }, [entries])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 h-8 px-2 bg-muted/30 border-b">
        <span className="text-xs text-muted-foreground">回放: {title}</span>
        <div className="flex-1" />
        <Button size="xs" variant="ghost" aria-label={playing ? '暂停回放' : '开始回放'} disabled={entries.length === 0} onClick={togglePlay}>
          {playing ? (
            <Pause className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
        </Button>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">
            {speed}x
          </span>
        </div>
      </div>
      <div ref={containerRef} className="flex-1" />
      <div className="flex items-center gap-2 px-3 py-1.5 border-t border-border bg-muted/30">
        <Slider
          value={[progress]}
          min={0}
          max={100}
          onValueChange={(value: number | readonly number[]) => {
            if (typeof value === 'number') {
              seek(value)
            } else if (value.length > 0) {
              seek(value[0])
            }
          }}
          className="flex-1"
        />
        <div className="flex items-center gap-1 flex-shrink-0">
          {[0.5, 1, 2, 4].map((s) => (
            <Button
              key={s}
              size="xs"
              variant={speed === s ? 'default' : 'ghost'}
              className="text-xs"
              onClick={() => handleSpeedChange(s)}
            >
              {s}x
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}
