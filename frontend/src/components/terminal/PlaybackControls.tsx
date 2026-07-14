import { Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'

const PLAYBACK_SPEEDS = [0.5, 1, 2, 4]

interface HeaderProps {
  title: string
  playing: boolean
  disabled: boolean
  speed: number
  onToggle: () => void
}

interface TimelineProps {
  progress: number
  speed: number
  onSeek: (value: number) => void
  onSpeed: (value: number) => void
}

export function PlaybackHeader({ title, playing, disabled, speed, onToggle }: HeaderProps) {
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

export function PlaybackTimeline({ progress, speed, onSeek, onSpeed }: TimelineProps) {
  return (
    <div className="flex items-center gap-2 border-t border-border bg-muted/30 px-3 py-1.5">
      <Slider aria-label="回放进度" value={[progress]} min={0} max={100} onValueChange={(value) => onSeek(typeof value === 'number' ? value : value[0])} className="flex-1" />
      <div className="flex flex-shrink-0 items-center gap-1">
        {PLAYBACK_SPEEDS.map((value) => <Button key={value} size="xs" variant={speed === value ? 'default' : 'ghost'} className="text-xs" onClick={() => onSpeed(value)}>{value}x</Button>)}
      </div>
    </div>
  )
}
