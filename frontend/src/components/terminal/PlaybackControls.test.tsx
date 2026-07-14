import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/ui/slider', () => ({
  Slider: ({ value, onValueChange, ...props }: { value: number[]; onValueChange: (value: number[]) => void }) => (
    <input
      {...props}
      type="range"
      value={value[0]}
      onChange={(event) => onValueChange([Number(event.target.value)])}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') onValueChange([value[0] + 1])
      }}
    />
  ),
}))

import { PlaybackHeader, PlaybackTimeline } from '@/components/terminal/PlaybackControls'

describe('PlaybackControls', () => {
  it('toggles playback and changes speed', async () => {
    const onToggle = vi.fn()
    const onSeek = vi.fn()
    const onSpeed = vi.fn()
    const user = userEvent.setup()
    render(
      <>
        <PlaybackHeader title="demo" playing={false} disabled={false} speed={1} onToggle={onToggle} />
        <PlaybackTimeline progress={25} speed={1} onSeek={onSeek} onSpeed={onSpeed} />
      </>,
    )

    await user.click(screen.getByRole('button', { name: '开始回放' }))
    await user.click(screen.getByRole('button', { name: '2x' }))

    expect(onToggle).toHaveBeenCalledOnce()
    expect(onSpeed).toHaveBeenCalledWith(2)
    expect(screen.getByText('回放: demo')).toBeInTheDocument()
  })

  it('disables playback and seeks with the keyboard', async () => {
    const onToggle = vi.fn()
    const onSeek = vi.fn()
    const onSpeed = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(
      <PlaybackHeader title="demo" playing={false} disabled speed={1} onToggle={onToggle} />,
    )

    expect(screen.getByRole('button', { name: '开始回放' })).toBeDisabled()
    rerender(<PlaybackTimeline progress={25} speed={1} onSeek={onSeek} onSpeed={onSpeed} />)
    const slider = screen.getByRole('slider', { name: '回放进度' })
    slider.focus()
    await user.keyboard('{ArrowRight}')

    expect(onSeek).toHaveBeenCalledWith(26)
  })
})
