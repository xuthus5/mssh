import { useRef, useEffect, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Play, Pause } from 'lucide-react'

interface Props {
  recordingId: string
  title: string
}

export function PlaybackTab({ recordingId: _recordingId, title }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: false,
      disableStdin: true,
      fontSize: 14,
      fontFamily: '"JetBrains Mono", "Cascadia Code", monospace',
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
      },
      scrollback: 10000,
    })
    termRef.current = term

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

    console.debug('[PlaybackTab] init', _recordingId)

    return () => {
      resizeObs.disconnect()
      term.dispose()
    }
  }, [_recordingId])

  const togglePlay = () => {
    const next = !playing
    setPlaying(next)
    console.debug(
      '[Wails:RecordingService.' + (next ? 'Play' : 'Pause') + ']',
      _recordingId,
    )
  }

  const handleSpeedChange = (value: number | number[]) => {
    const v = typeof value === 'number' ? value : value[0]
    setSpeed(v)
    console.debug('[Wails:RecordingService.SetSpeed]', _recordingId, v)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 h-8 px-2 bg-muted/30 border-b">
        <span className="text-xs text-muted-foreground">回放: {title}</span>
        <div className="flex-1" />
        <Button size="xs" variant="ghost" onClick={togglePlay}>
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
              setProgress(value)
            } else if (value.length > 0) {
              setProgress(value[0])
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
