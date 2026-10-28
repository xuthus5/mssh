import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Browser } from '@wailsio/runtime'
import { GistOAuthConnect } from '@/components/settings/GistOAuthConnect'
import { GistOAuthStatus, type GistOAuthResult, type GistOAuthStart, type GistSyncConfig } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

const clipboard = vi.hoisted(() => ({ writeText: vi.fn(async () => {}) }))
vi.mock('@/lib/clipboard', () => ({ getClipboard: () => ({ readText: vi.fn(async () => ''), writeText: clipboard.writeText }) }))

const start: GistOAuthStart = {
  flow_id: 'flow-1', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device',
  expires_at: '2030-01-01T00:00:00Z', interval_seconds: 5,
}

function result(overrides: Partial<GistOAuthResult> = {}): GistOAuthResult {
  return { status: GistOAuthStatus.GistOAuthSuccess, message: '已连接 GitHub', account: 'octocat', gist_id: 'gist-1', retry_after_seconds: 0, ...overrides }
}

function setup(overrides: Partial<Parameters<typeof GistOAuthConnect>[0]> = {}) {
  const props = {
    saved: undefined as GistSyncConfig | undefined,
    pending: null,
    onStart: vi.fn(async () => start),
    onPoll: vi.fn(async () => result({ status: GistOAuthStatus.GistOAuthPending, retry_after_seconds: 5 })),
    onCancel: vi.fn(async () => {}),
    onConnected: vi.fn(),
    ...overrides,
  }
  render(<GistOAuthConnect {...props} />)
  return props
}

describe('GistOAuthConnect', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    clipboard.writeText.mockClear()
    vi.spyOn(Browser, 'OpenURL').mockResolvedValue(undefined)
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('opens GitHub, polls until success, and reports the connected account', async () => {
    const onPoll = vi.fn()
      .mockResolvedValueOnce(result({ status: GistOAuthStatus.GistOAuthPending, retry_after_seconds: 1 }))
      .mockResolvedValueOnce(result())
    const props = setup({ onPoll })
    await userEvent.click(screen.getByRole('button', { name: '使用 GitHub 授权' }))

    expect(screen.getByText('ABCD-1234')).toBeInTheDocument()
    expect(Browser.OpenURL).toHaveBeenCalledWith(start.verification_uri)
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(onPoll).toHaveBeenCalledWith('flow-1')
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(props.onConnected).toHaveBeenCalledWith(result())
    expect(screen.getByText(/octocat/)).toBeInTheDocument()
  })

  it('shows an error when starting authorization fails', async () => {
    setup({ onStart: vi.fn(async () => { throw new Error('start failed') }) })
    await userEvent.click(screen.getByRole('button', { name: '使用 GitHub 授权' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('start failed')
  })

  it('shows an error when polling fails and stops polling', async () => {
    const onPoll = vi.fn(async () => { throw new Error('poll failed') })
    setup({ onPoll })
    await userEvent.click(screen.getByRole('button', { name: '使用 GitHub 授权' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(await screen.findByRole('alert')).toHaveTextContent('poll failed')
  })

  it('shows a failed authorization response', async () => {
    const onPoll = vi.fn(async () => result({ status: GistOAuthStatus.GistOAuthFailed, message: 'GitHub 授权已取消' }))
    setup({ onPoll })
    await userEvent.click(screen.getByRole('button', { name: '使用 GitHub 授权' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub 授权已取消')
  })

  it('copies the user code and opens the verification page manually', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: '使用 GitHub 授权' }))
    await userEvent.click(screen.getByRole('button', { name: '复制' }))
    expect(clipboard.writeText).toHaveBeenCalledWith('ABCD-1234')
    await userEvent.click(screen.getByRole('button', { name: '打开 GitHub' }))
    expect(Browser.OpenURL).toHaveBeenCalledTimes(2)
  })

  it('surfaces clipboard, browser, and cancellation failures without stopping the flow', async () => {
    clipboard.writeText.mockRejectedValueOnce(new Error('clipboard denied'))
    vi.mocked(Browser.OpenURL).mockRejectedValue(new Error('browser denied'))
    const props = setup({ onCancel: vi.fn(async () => { throw new Error('cancel denied') }) })
    await userEvent.click(screen.getByRole('button', { name: '使用 GitHub 授权' }))
    expect(screen.getByText(/无法自动打开浏览器/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '复制' }))
    expect(screen.getByRole('alert')).toHaveTextContent('clipboard denied')
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(props.onCancel).toHaveBeenCalledWith('flow-1')
    expect(screen.queryByText('ABCD-1234')).not.toBeInTheDocument()
  })

  it('cancels an in-flight flow when unmounted', async () => {
    const onCancel = vi.fn(async () => {})
    const view = render(<GistOAuthConnect saved={undefined} pending={null} onStart={vi.fn(async () => start)} onPoll={vi.fn(async () => result({ status: GistOAuthStatus.GistOAuthPending, retry_after_seconds: 5 }))} onCancel={onCancel} onConnected={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: '使用 GitHub 授权' }))
    view.unmount()
    await waitFor(() => expect(onCancel).toHaveBeenCalledWith('flow-1'))
  })

  it('cancels a device flow that starts after unmount', async () => {
    let resolveStart: ((value: GistOAuthStart) => void) | undefined
    const onStart = vi.fn(() => new Promise<GistOAuthStart>((resolve) => { resolveStart = resolve }))
    const onCancel = vi.fn(async () => {})
    const view = render(<GistOAuthConnect saved={undefined} pending={null} onStart={onStart} onPoll={vi.fn()} onCancel={onCancel} onConnected={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: '使用 GitHub 授权' }))
    view.unmount()
    await act(async () => { resolveStart?.(start); await Promise.resolve() })
    await waitFor(() => expect(onCancel).toHaveBeenCalledWith('flow-1'))
  })

  it('shows saved credentials and disables actions while another operation runs', () => {
    setup({ saved: { gist_id: 'gist-1', token_saved: true }, pending: 'sync' })
    expect(screen.getByRole('button', { name: '重新授权' })).toBeDisabled()
    expect(screen.getByText(/GitHub 凭据已加密保存/)).toBeInTheDocument()
    expect(screen.getByText(/gist-1/)).toBeInTheDocument()
  })

  it('ignores a second start click while the first request is pending', async () => {
    let resolveStart: ((value: GistOAuthStart) => void) | undefined
    const onStart = vi.fn(() => new Promise<GistOAuthStart>((resolve) => { resolveStart = resolve }))
    setup({ onStart })
    const button = screen.getByRole('button', { name: '使用 GitHub 授权' })
    await userEvent.click(button)
    await userEvent.click(button)
    expect(onStart).toHaveBeenCalledOnce()
    await act(async () => { resolveStart?.(start); await Promise.resolve() })
  })
})
