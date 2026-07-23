import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import type { TerminalRuntimeErrorReporter } from '@/components/terminal/TerminalErrorBoundary'
import { installTerminalCopyOnSelect } from '@/components/terminal/terminalBehaviorRuntime'
import { runTerminalRuntime } from '@/components/terminal/terminalRuntime'
import {
  createPlaybackResizeObserver,
  decodeRecordingData,
  recoverPlaybackView,
} from '@/components/terminal/playbackTerminalRuntime'
import { logger } from '@/lib/logger'
import { applyTerminalTheme, xtermTheme } from '@/lib/terminalTheme'
import { LogService } from '@/lib/wails'
import { useAppStore } from '@/store/appStore'
import { t } from '@/i18n'

const PLAYBACK_INTERVAL_MS = 16
const PLAYBACK_SCROLLBACK = 10000
const MAX_PROGRESS = 100

export interface RecordingEntry {
  timestamp: number
  type: number
  data: string
}

interface PlayerData {
  entries: RecordingEntry[]
}

export interface PlaybackCursor {
  timer: ReturnType<typeof setInterval> | null
  index: number
  position: number
  lastTick: number
}

interface PlaybackLifecycleOptions {
  recordingId: string
  title: string
  containerRef: RefObject<HTMLDivElement | null>
  termRef: RefObject<Terminal | null>
  fitAddonRef: RefObject<FitAddon | null>
  activeRef: RefObject<boolean>
  recoveryPendingRef: RefObject<boolean>
  cursorRef: RefObject<PlaybackCursor>
  setEntries: (entries: RecordingEntry[]) => void
  reportRuntimeError: TerminalRuntimeErrorReporter
}

interface PlaybackControlOptions {
  entries: RecordingEntry[]
  termRef: RefObject<Terminal | null>
  cursorRef: RefObject<PlaybackCursor>
  reportRuntimeError: TerminalRuntimeErrorReporter
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

async function loadRecording({
  recordingId, title, term, setEntries, isDisposed, reportRuntimeError,
}: {
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
    runTerminalRuntime(reportRuntimeError, 'playback load status', () => {
      term.writeln(`\x1b[31m${t('加载录制失败')}\x1b[0m`)
    })
    return
  }
  if (isDisposed()) return
  runTerminalRuntime(reportRuntimeError, 'playback recording render', () => {
    if (!player?.entries) {
      term.writeln(`\x1b[33m${t('未找到录制数据')}\x1b[0m`)
      return
    }
    setEntries(player.entries)
    term.writeln(`\x1b[1;36m${t('录制：${}', title)}\x1b[0m`)
    term.writeln(`\x1b[90m${t('${} 条记录可回放', player.entries.length)}\x1b[0m`)
  })
}

function createPlaybackTerminal() {
  const terminalTheme = useAppStore.getState().terminalTheme
  return new Terminal({
    cursorBlink: false,
    cursorStyle: terminalTheme.cursorStyle,
    disableStdin: true,
    fontSize: terminalTheme.fontSize,
    fontFamily: terminalTheme.fontFamily,
    theme: xtermTheme(terminalTheme),
    scrollback: PLAYBACK_SCROLLBACK,
  })
}

export function usePlaybackLifecycle({
  recordingId, title, containerRef, termRef, fitAddonRef, activeRef, recoveryPendingRef, cursorRef, setEntries, reportRuntimeError,
}: PlaybackLifecycleOptions) {
  useEffect(() => {
    let disposed = false
    const container = containerRef.current
    const term = createPlaybackTerminal()
    const fitAddon = new FitAddon()
    termRef.current = term
    fitAddonRef.current = fitAddon
    term.loadAddon(fitAddon)
    if (container) term.open(container)
    const disposeCopyOnSelect = installTerminalCopyOnSelect(term, 'playback')
    const unsubscribeTheme = useAppStore.subscribe((state, previous) => {
      if (state.terminalTheme !== previous.terminalTheme) {
        runTerminalRuntime(reportRuntimeError, 'playback theme update', () => {
          applyTerminalTheme(term.options, state.terminalTheme)
          if (!activeRef.current || !recoverPlaybackView(term, fitAddon, containerRef.current)) {
            recoveryPendingRef.current = true
            return
          }
          recoveryPendingRef.current = false
        })
      }
    })
    const resizeObserver = createPlaybackResizeObserver({
      term, fitAddon, containerRef, activeRef, recoveryPendingRef, reportRuntimeError,
    })
    if (container) resizeObserver.observe(container)
    void loadRecording({ recordingId, title, term, setEntries, isDisposed: () => disposed, reportRuntimeError })

    return () => {
      if (disposed) return
      disposed = true
      stopPlayback(cursorRef.current)
      safelyDispose('resize observer', () => resizeObserver.disconnect())
      safelyDispose('theme subscription', unsubscribeTheme)
      safelyDispose('copy-on-select', disposeCopyOnSelect)
      safelyDispose('terminal', () => term.dispose())
      fitAddonRef.current = null
      termRef.current = null
    }
  }, [containerRef, cursorRef, fitAddonRef, recordingId, reportRuntimeError, setEntries, termRef, title])
}

export function usePlaybackActivation({
  active, containerRef, termRef, fitAddonRef, recoveryPendingRef, reportRuntimeError,
}: {
  active: boolean
  containerRef: RefObject<HTMLDivElement | null>
  termRef: RefObject<Terminal | null>
  fitAddonRef: RefObject<FitAddon | null>
  recoveryPendingRef: RefObject<boolean>
  reportRuntimeError: TerminalRuntimeErrorReporter
}) {
  const frameRef = useRef<number | null>(null)
  useEffect(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    recoveryPendingRef.current = active
    if (!active) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      const term = termRef.current
      const fitAddon = fitAddonRef.current
      if (!term || !fitAddon) return
      runTerminalRuntime(reportRuntimeError, 'playback activation', () => {
        if (recoverPlaybackView(term, fitAddon, containerRef.current)) recoveryPendingRef.current = false
      })
    })
    return () => {
      if (frameRef.current === null) return
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [active, containerRef, fitAddonRef, recoveryPendingRef, reportRuntimeError, termRef])
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

function advancePlayback({
  term, entries, cursor, speed, setProgress, setPlaying,
}: {
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

export function usePlaybackControls({ entries, termRef, cursorRef, reportRuntimeError }: PlaybackControlOptions) {
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
