import { useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { useTerminalRuntimeErrorReporter } from '@/components/terminal/TerminalErrorBoundary'
import { PlaybackHeader, PlaybackTimeline } from '@/components/terminal/PlaybackControls'
import {
  usePlaybackActivation,
  usePlaybackControls,
  usePlaybackLifecycle,
  type PlaybackCursor,
  type RecordingEntry,
} from '@/components/terminal/playbackPlayerRuntime'
import { t } from '@/i18n'

interface Props {
  recordingId: string
  title: string
  active: boolean
}

export function PlaybackTab({ recordingId, title, active }: Props) {
  const reportRuntimeError = useTerminalRuntimeErrorReporter()
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const activeRef = useRef(active)
  const recoveryPendingRef = useRef(false)
  const cursorRef = useRef<PlaybackCursor>({ timer: null, index: 0, position: 0, lastTick: 0 })
  const [entries, setEntries] = useState<RecordingEntry[]>([])
  activeRef.current = active
  usePlaybackLifecycle({
    recordingId, title, containerRef, termRef, fitAddonRef, activeRef, recoveryPendingRef, cursorRef, setEntries, reportRuntimeError,
  })
  usePlaybackActivation({ active, containerRef, termRef, fitAddonRef, recoveryPendingRef, reportRuntimeError })
  const controls = usePlaybackControls({ entries, termRef, cursorRef, reportRuntimeError })

  return (
    <div
      role="region"
      aria-label={t('回放: ${}', title)}
      className="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden"
    >
      <PlaybackHeader title={title} playing={controls.playing} disabled={entries.length === 0} speed={controls.speed} onToggle={controls.togglePlay} />
      <div
        ref={containerRef}
        aria-label={t('回放终端')}
        className="min-h-0 min-w-0 w-full flex-1 overflow-hidden"
      />
      <PlaybackTimeline progress={controls.progress} speed={controls.speed} onSeek={controls.seek} onSpeed={controls.changeSpeed} />
    </div>
  )
}
