import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store/appStore'

const { getRecording } = vi.hoisted(() => ({ getRecording: vi.fn(async (): Promise<any> => ({ entries: [] })) }))
const terminalInstances: Array<{ options: Record<string, any>; writeln: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> }> = []
vi.mock('@xterm/xterm', () => ({ Terminal: class { options: Record<string, any>; writeln = vi.fn(); loadAddon = vi.fn(); open = vi.fn(); dispose = vi.fn(); write = vi.fn(); reset = vi.fn(); rows = 24; constructor(options: Record<string, any>) { this.options = options; terminalInstances.push(this) } } }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn() } }))
vi.mock('@/lib/wails', () => ({ LogService: { GetRecording: getRecording } }))

import { PlaybackTab } from '@/components/terminal/PlaybackTab'

describe('PlaybackTab terminal theme', () => {
  beforeEach(() => {
    terminalInstances.length = 0
    getRecording.mockResolvedValue({ entries: [] })
    vi.stubGlobal('ResizeObserver', class { observe() {}; disconnect() {} })
  })

  it('hot-applies terminal theme changes to an open playback terminal', async () => {
    render(<PlaybackTab recordingId="1" title="demo" />)
    await waitFor(() => expect(terminalInstances).toHaveLength(1))
    useAppStore.getState().setTerminalTheme({ ...useAppStore.getState().terminalTheme, background: '#ffffff', fontSize: 18 })
    await waitFor(() => expect(terminalInstances[0].options).toMatchObject({ fontSize: 18, theme: expect.objectContaining({ background: '#ffffff' }) }))
  })

  it('writes millisecond-timestamped entries after playback starts', async () => {
    getRecording.mockResolvedValue({ entries: [{ timestamp: 0, type: 0, data: 'QQ==' }, { timestamp: 10, type: 0, data: 'Qg==' }] })
    render(<PlaybackTab recordingId="1" title="demo" />)
    await waitFor(() => expect(screen.getByRole('button', { name: '开始回放' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: '开始回放' }))
    await waitFor(() => expect(terminalInstances[0].write).toHaveBeenCalledWith(new Uint8Array([65])))
  })
})
