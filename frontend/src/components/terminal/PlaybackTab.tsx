import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { useTerminalRuntimeErrorReporter, type TerminalRuntimeErrorReporter } from '@/components/terminal/TerminalErrorBoundary'
import { runTerminalRuntime } from '@/components/terminal/terminalRuntime'
import { logger } from '@/lib/logger'
import { applyTerminalTheme, xtermTheme } from '@/lib/terminalTheme'
import { LogService } from '@/lib/wails'
import { useAppStore } from '@/store/appStore'

const PLAYBACK_INTERVAL_MS = 16
const PLAYBACK_SCROLLBACK = 10000
const MAX_PROGRESS = 100
const PLAYBACK_SPEEDS = [0.5, 1, 2, 4]

interface RecordingEntry {
  timestamp: number
  type: number
  data: string
}

interface PlayerData {
  entries: RecordingEntry[]
}

interface PlaybackCursor {
  timer: ReturnType<typeof setInterval> | null
  index: number
  position: number
  lastTick: number
}

interface Props {
  recordingId: string
  title: string
  active: boolean
}

function hasVisibleSize(container: HTMLDivElement | null): container is HTMLDivElement {
  return container !== null && container.clientWidth > 0 && container.clientHeight > 0
}

function stopPlayback(cursor: PlaybackCursor) {
  if (cursor.timer === null) return
  const timer = cursor.timer
  cursor.timer = null
  clearInterval(timer)
}

function safelyDispose(label: string, dispose: () => void) {
  try {
    dispose()
  } catch (error: unknown) {
    logger.error(`playback ${label} cleanup error`, error)
  }
}

async function loadRecording({ recordingId, title, term, setEntries, isDisposed, reportRuntimeError }: {
  recordingId: string
  title: string
  term: Terminal
  setEntries: (entries: RecordingEntry[]) => void
  isDisposed: () => boolean
  reportRuntimeError: TerminalRuntimeErrorReporter
}) {
  let player: PlayerData | null
  try {
    player = await LogService.GetRecording(String(recordingId)) as PlayerData | null
  } catch (error: unknown) {
    if (isDisposed()) return
    logger.error('PlaybackTab: GetRecording error:', error)
    runTerminalRuntime(reportRuntimeError, 'playback load status', () => term.writeln('\x1b[31mFailed to load recording\x1b[0m'))
    return
  }
  if (isDisposed()) return
  runTerminalRuntime(reportRuntimeError, 'playback recording render', () => {
    if (!player?.entries) {
      term.writeln('\x1b[33mNo recording data found\x1b[0m')
      return
    }
    setEntries(player.entries)
    term.writeln(`\x1b[1;36mRecording: ${title}\x1b[0m`)
    term.writeln(`\x1b[90m${player.entries.length} entries ready for playback\x1b[0m`)
  })
}

function createPlaybackTerminal() {
  const terminalTheme = useAppStore.getState().terminalTheme
  return new Terminal({
    cursorBlink: false,
    disableStdin: true,
    fontSize: terminalTheme.fontSize,
    fontFamily: terminalTheme.fontFamily,
    theme: xtermTheme(terminalTheme),
    scrollback: PLAYBACK_SCROLLBACK,
  })
}

function usePlaybackLifecycle({ recordingId, title, containerRef, termRef, fitAddonRef, activeRef, cursorRef, setEntries, reportRuntimeError }: {
  recordingId: string
  title: string
  containerRef: RefObject<HTMLDivElement | null>
  termRef: RefObject<Terminal | null>
  fitAddonRef: RefObject<FitAddon | null>
  activeRef: RefObject<boolean>
  cursorRef: RefObject<PlaybackCursor>
  setEntries: (entries: RecordingEntry[]) => void
  reportRuntimeError: TerminalRuntimeErrorReporter
}) {
  useEffect(() => {
    let disposed = false
    const container = containerRef.current
    const term = createPlaybackTerminal()
    const fitAddon = new FitAddon()
    termRef.current = term
    fitAddonRef.current = fitAddon
    term.loadAddon(fitAddon)
    if (container) term.open(container)
    const unsubscribeTheme = useAppStore.subscribe((state, previous) => {
      if (state.terminalTheme !== previous.terminalTheme) {
        runTerminalRuntime(reportRuntimeError, 'playback theme update', () => applyTerminalTheme(term.options, state.terminalTheme))
      }
    })
    const resizeObserver = new ResizeObserver(() => {
      runTerminalRuntime(reportRuntimeError, 'playback resize', () => {
        if (activeRef.current && hasVisibleSize(containerRef.current)) fitAddon.fit()
      })
    })
    if (container) resizeObserver.observe(container)
    void loadRecording({ recordingId, title, term, setEntries, isDisposed: () => disposed, reportRuntimeError })

    return () => {
      if (disposed) return
      disposed = true
      stopPlayback(cursorRef.current)
      safelyDispose('resize observer', () => resizeObserver.disconnect())
      safelyDispose('theme subscription', unsubscribeTheme)
      safelyDispose('terminal', () => term.dispose())
      fitAddonRef.current = null
      termRef.current = null
    }
  }, [containerRef, cursorRef, fitAddonRef, recordingId, reportRuntimeError, setEntries, termRef, title])
}

function usePlaybackActivation({ active, containerRef, termRef, fitAddonRef, reportRuntimeError }: {
  active: boolean
  containerRef: RefObject<HTMLDivElement | null>
  termRef: RefObject<Terminal | null>
  fitAddonRef: RefObject<FitAddon | null>
  reportRuntimeError: TerminalRuntimeErrorReporter
}) {
  const frameRef = useRef<number | null>(null)
  useEffect(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    if (!active) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      const term = termRef.current
      const fitAddon = fitAddonRef.current
      if (!term || !fitAddon || !hasVisibleSize(containerRef.current)) return
      runTerminalRuntime(reportRuntimeError, 'playback activation', () => {
        fitAddon.fit()
        term.refresh(0, term.rows - 1)
      })
    })
    return () => {
      if (frameRef.current === null) return
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [active, containerRef, fitAddonRef, reportRuntimeError, termRef])
}

function writeUntil(term: Terminal, entries: RecordingEntry[], cursor: PlaybackCursor) {
  let nextIndex = cursor.index
  while (nextIndex < entries.length && entries[nextIndex].timestamp <= cursor.position) {
    const entry = entries[nextIndex]
    if (entry.data) term.write(decodeRecordingData(entry.data))
    nextIndex++
  }
  cursor.index = nextIndex
}

function advancePlayback({ term, entries, cursor, speed, setProgress, setPlaying }: {
  term: Terminal
  entries: RecordingEntry[]
  cursor: PlaybackCursor
  speed: number
  setProgress: (value: number) => void
  setPlaying: (value: boolean) => void
}) {
  const now = Date.now()
  cursor.position += (now - cursor.lastTick) * speed
  cursor.lastTick = now
  writeUntil(term, entries, cursor)
  const duration = entries.at(-1)?.timestamp ?? 0
  setProgress(duration > 0 ? Math.min(MAX_PROGRESS, Math.round((cursor.position / duration) * MAX_PROGRESS)) : 0)
  if (cursor.index < entries.length) return
  stopPlayback(cursor)
  setPlaying(false)
}

function usePlaybackControls(entries: RecordingEntry[], termRef: RefObject<Terminal | null>, cursorRef: RefObject<PlaybackCursor>, reportRuntimeError: TerminalRuntimeErrorReporter) {
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [progress, setProgress] = useState(0)
  const speedRef = useRef(1)
  const togglePlay = useCallback(() => {
    const term = termRef.current
    if (!term || entries.length === 0) return
    const cursor = cursorRef.current
    if (playing) {
      stopPlayback(cursor)
      setPlaying(false)
      return
    }
    cursor.lastTick = Date.now()
    cursor.timer = setInterval(() => {
      const succeeded = runTerminalRuntime(reportRuntimeError, 'playback timer', () => {
        advancePlayback({ term, entries, cursor, speed: speedRef.current, setProgress, setPlaying })
      })
      if (!succeeded) stopPlayback(cursor)
    }, PLAYBACK_INTERVAL_MS)
    setPlaying(true)
  }, [cursorRef, entries, playing, reportRuntimeError, termRef])
  const changeSpeed = useCallback((value: number) => {
    setSpeed(value)
    speedRef.current = value
  }, [])
  const seek = useCallback((percentage: number) => {
    const term = termRef.current
    if (!term || entries.length === 0) return
    const cursor = cursorRef.current
    runTerminalRuntime(reportRuntimeError, 'playback seek', () => {
      cursor.position = (entries.at(-1)?.timestamp ?? 0) * Math.max(0, Math.min(MAX_PROGRESS, percentage)) / MAX_PROGRESS
      cursor.index = 0
      term.reset()
      writeUntil(term, entries, cursor)
      cursor.lastTick = Date.now()
      setProgress(percentage)
    })
  }, [cursorRef, entries, reportRuntimeError, termRef])
  return { playing, speed, progress, togglePlay, changeSpeed, seek }
}

function PlaybackHeader({ title, playing, disabled, speed, onToggle }: { title: string; playing: boolean; disabled: boolean; speed: number; onToggle: () => void }) {
  return (
    <div className="flex h-8 items-center gap-2 border-b bg-muted/30 px-2">
      <span className="text-xs text-muted-foreground">回放: {title}</span>
      <div className="flex-1" />
      <Button size="xs" variant="ghost" aria-label={playing ? '暂停回放' : '开始回放'} disabled={disabled} onClick={onToggle}>
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </Button>
      <span className="text-xs text-muted-foreground">{speed}x</span>
    </div>
  )
}

function PlaybackTimeline({ progress, speed, onSeek, onSpeed }: { progress: number; speed: number; onSeek: (value: number) => void; onSpeed: (value: number) => void }) {
  return (
    <div className="flex items-center gap-2 border-t border-border bg-muted/30 px-3 py-1.5">
      <Slider value={[progress]} min={0} max={MAX_PROGRESS} onValueChange={(value) => onSeek(typeof value === 'number' ? value : value[0])} className="flex-1" />
      <div className="flex flex-shrink-0 items-center gap-1">
        {PLAYBACK_SPEEDS.map((value) => <Button key={value} size="xs" variant={speed === value ? 'default' : 'ghost'} className="text-xs" onClick={() => onSpeed(value)}>{value}x</Button>)}
      </div>
    </div>
  )
}

export function PlaybackTab({ recordingId, title, active }: Props) {
  const reportRuntimeError = useTerminalRuntimeErrorReporter()
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const activeRef = useRef(active)
  const cursorRef = useRef<PlaybackCursor>({ timer: null, index: 0, position: 0, lastTick: 0 })
  const [entries, setEntries] = useState<RecordingEntry[]>([])
  activeRef.current = active
  usePlaybackLifecycle({ recordingId, title, containerRef, termRef, fitAddonRef, activeRef, cursorRef, setEntries, reportRuntimeError })
  usePlaybackActivation({ active, containerRef, termRef, fitAddonRef, reportRuntimeError })
  const controls = usePlaybackControls(entries, termRef, cursorRef, reportRuntimeError)

  return (
    <div className="flex h-full flex-col">
      <PlaybackHeader title={title} playing={controls.playing} disabled={entries.length === 0} speed={controls.speed} onToggle={controls.togglePlay} />
      <div ref={containerRef} className="flex-1" />
      <PlaybackTimeline progress={controls.progress} speed={controls.speed} onSeek={controls.seek} onSpeed={controls.changeSpeed} />
    </div>
  )
}

export function decodeRecordingData(encoded: string) {
  const binary = atob(encoded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}
