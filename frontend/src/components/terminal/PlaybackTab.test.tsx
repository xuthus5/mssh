import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store/appStore'
import { logger } from '@/lib/logger'

const { getRecording } = vi.hoisted(() => ({ getRecording: vi.fn(async (): Promise<any> => ({ entries: [] })) }))
const terminalInstances: Array<{ options: Record<string, any>; writeln: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn>; refresh: ReturnType<typeof vi.fn>; reset: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }> = []
const fitInstances: Array<{ fit: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }> = []
vi.mock('@xterm/xterm', () => ({ Terminal: class { options: Record<string, any>; writeln = vi.fn(); loadAddon = vi.fn(); open = vi.fn(); dispose = vi.fn(); write = vi.fn(); reset = vi.fn(); refresh = vi.fn(); rows = 24; constructor(options: Record<string, any>) { this.options = options; terminalInstances.push(this) } } }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn(); dispose = vi.fn(); constructor() { fitInstances.push(this) } } }))
vi.mock('@/lib/wails', () => ({ LogService: { GetRecording: getRecording } }))
vi.mock('@/components/ui/slider', () => ({
  Slider: ({ value, onValueChange }: { value: number[]; onValueChange: (value: number[]) => void }) => (
    <input aria-label="回放进度" type="range" value={value[0]} onChange={(event) => onValueChange([Number(event.target.value)])} />
  ),
}))

import { PlaybackTab } from '@/components/terminal/PlaybackTab'

describe('PlaybackTab terminal theme', () => {
  beforeEach(() => {
    terminalInstances.length = 0
    fitInstances.length = 0
    getRecording.mockResolvedValue({ entries: [] })
    vi.stubGlobal('ResizeObserver', class { observe() {}; disconnect() {} })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500)
  })

  it('hot-applies terminal theme changes to an open playback terminal', async () => {
    render(<PlaybackTab recordingId="1" title="demo" active />)
    await waitFor(() => expect(terminalInstances).toHaveLength(1))
    useAppStore.getState().setTerminalTheme({ ...useAppStore.getState().terminalTheme, background: '#ffffff', fontSize: 18 })
    await waitFor(() => expect(terminalInstances[0].options).toMatchObject({ fontSize: 18, theme: expect.objectContaining({ background: '#ffffff' }) }))
  })

  it('writes millisecond-timestamped entries after playback starts', async () => {
    getRecording.mockResolvedValue({ entries: [{ timestamp: 0, type: 0, data: 'QQ==' }, { timestamp: 10, type: 0, data: 'Qg==' }] })
    render(<PlaybackTab recordingId="1" title="demo" active />)
    await waitFor(() => expect(screen.getByRole('button', { name: '开始回放' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: '开始回放' }))
    await waitFor(() => expect(terminalInstances[0].write).toHaveBeenCalledWith(new Uint8Array([65])))
  })

  it('reports missing and failed recording loads in the terminal', async () => {
    getRecording.mockResolvedValueOnce(null)
    const missing = render(<PlaybackTab recordingId="missing" title="demo" active />)
    await waitFor(() => expect(terminalInstances[0].writeln).toHaveBeenCalledWith(expect.stringContaining('No recording data found')))
    missing.unmount()

    const loadError = new Error('recording unavailable')
    const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => {})
    getRecording.mockRejectedValueOnce(loadError)
    render(<PlaybackTab recordingId="failed" title="demo" active />)

    await waitFor(() => expect(terminalInstances[1].writeln).toHaveBeenCalledWith(expect.stringContaining('Failed to load recording')))
    expect(loggerError).toHaveBeenCalledWith('PlaybackTab: GetRecording error:', loadError)
  })

  it('pauses, changes speed, and seeks without remounting', async () => {
    getRecording.mockResolvedValue({ entries: [{ timestamp: 0, type: 0, data: 'QQ==' }, { timestamp: 1000, type: 0, data: 'Qg==' }] })
    render(<PlaybackTab recordingId="1" title="demo" active />)
    await waitFor(() => expect(screen.getByRole('button', { name: '开始回放' })).toBeEnabled())

    await userEvent.click(screen.getByRole('button', { name: '2x' }))
    expect(screen.getAllByText('2x')).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: '开始回放' }))
    await userEvent.click(screen.getByRole('button', { name: '暂停回放' }))
    fireEvent.change(screen.getByRole('slider', { name: '回放进度' }), { target: { value: '50' } })

    expect(screen.getByRole('button', { name: '开始回放' })).toBeInTheDocument()
    expect(terminalInstances[0].reset).toHaveBeenCalledOnce()
    expect(terminalInstances[0].write).toHaveBeenCalledWith(new Uint8Array([65]))
  })

  it('refits and refreshes when a hidden playback becomes visible', async () => {
    const { rerender } = render(<PlaybackTab recordingId="1" title="demo" active={false} />)
    await waitFor(() => expect(terminalInstances).toHaveLength(1))
    fitInstances[0].fit.mockClear()

    rerender(<PlaybackTab recordingId="1" title="demo" active />)

    await waitFor(() => expect(fitInstances[0].fit).toHaveBeenCalledOnce())
    expect(terminalInstances[0].refresh).toHaveBeenCalledOnce()
  })

  it('keeps playback running while its layer is hidden', async () => {
    getRecording.mockResolvedValue({ entries: [{ timestamp: 0, type: 0, data: 'QQ==' }] })
    const { rerender } = render(<PlaybackTab recordingId="1" title="demo" active />)
    await waitFor(() => expect(screen.getByRole('button', { name: '开始回放' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: '开始回放' }))

    rerender(<PlaybackTab recordingId="1" title="demo" active={false} />)

    expect(screen.getByRole('button', { name: '暂停回放' })).toBeInTheDocument()
  })

  it('disposes the fit addon and terminal once', () => {
    const { unmount } = render(<PlaybackTab recordingId="1" title="demo" active />)

    unmount()
    unmount()

    expect(fitInstances[0].dispose).toHaveBeenCalledOnce()
    expect(terminalInstances[0].dispose).toHaveBeenCalledOnce()
  })
})
