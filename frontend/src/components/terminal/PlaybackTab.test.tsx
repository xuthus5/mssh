import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store/appStore'

const terminalInstances: Array<{ options: Record<string, any>; writeln: ReturnType<typeof vi.fn> }> = []
vi.mock('@xterm/xterm', () => ({ Terminal: class { options: Record<string, any>; writeln = vi.fn(); loadAddon = vi.fn(); open = vi.fn(); dispose = vi.fn(); write = vi.fn(); rows = 24; constructor(options: Record<string, any>) { this.options = options; terminalInstances.push(this) } } }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn() } }))
vi.mock('@/lib/wails', () => ({ LogService: { GetRecording: vi.fn(async () => ({ entries: [] })) } }))

import { PlaybackTab } from '@/components/terminal/PlaybackTab'

describe('PlaybackTab terminal theme', () => {
  beforeEach(() => {
    terminalInstances.length = 0
    vi.stubGlobal('ResizeObserver', class { observe() {}; disconnect() {} })
  })

  it('hot-applies terminal theme changes to an open playback terminal', async () => {
    render(<PlaybackTab recordingId="1" title="demo" />)
    await waitFor(() => expect(terminalInstances).toHaveLength(1))
    useAppStore.getState().setTerminalTheme({ ...useAppStore.getState().terminalTheme, background: '#ffffff', fontSize: 18 })
    await waitFor(() => expect(terminalInstances[0].options).toMatchObject({ fontSize: 18, theme: expect.objectContaining({ background: '#ffffff' }) }))
  })
})
