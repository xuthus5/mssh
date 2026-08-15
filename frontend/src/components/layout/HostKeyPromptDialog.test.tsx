import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HostKeyPromptDialog } from '@/components/layout/HostKeyPromptDialog'
import { useHostKeyPromptDialog, type HostKeyPromptRequest } from '@/store/hostKeyPromptDialog'

describe('HostKeyPromptDialog', () => {
  beforeEach(() => {
    useHostKeyPromptDialog.setState({ active: null, pending: false, error: '' })
  })

  it('shows endpoint details and accepts the active fingerprint', async () => {
    const decide = vi.fn(async () => {})
    presentPrompt({ decide })
    render(<HostKeyPromptDialog />)

    expect(screen.getByText('host.internal:2222', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('SHA256:test')).toBeInTheDocument()
    expect(screen.getByText('ssh-ed25519')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '信任并连接' }))

    expect(decide).toHaveBeenCalledWith(true)
    expect(useHostKeyPromptDialog.getState().active).toBeNull()
  })

  it('rejects the active fingerprint', async () => {
    const decide = vi.fn(async () => {})
    presentPrompt({ decide })
    render(<HostKeyPromptDialog />)

    await userEvent.click(screen.getByRole('button', { name: '拒绝' }))

    expect(decide).toHaveBeenCalledWith(false)
    expect(useHostKeyPromptDialog.getState().active).toBeNull()
  })

  it('keeps a failed decision visible and allows fail-closed dismissal', async () => {
    const dismiss = vi.fn(async () => {})
    presentPrompt({ decide: async () => { throw new Error('decision boom') }, dismiss })
    render(<HostKeyPromptDialog />)

    await userEvent.click(screen.getByRole('button', { name: '信任并连接' }))
    await waitFor(() => expect(screen.getByText('decision boom')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '关闭' }))

    expect(dismiss).toHaveBeenCalledOnce()
    expect(useHostKeyPromptDialog.getState().active).toBeNull()
  })

  it('shows changed-fingerprint details and trusts the new key', async () => {
    const decide = vi.fn(async () => {})
    useHostKeyPromptDialog.getState().present({
      coordinatorId: 1,
      prompt: {
        attemptId: 'attempt-1',
        hostname: 'host.internal:2222',
        fingerprint: 'SHA256:new',
        algorithm: 'ssh-ed25519',
        changed: true,
        expected: ['SHA256:old'],
      },
      endpoint: { host: 'host.internal', port: 2222 },
      decide,
      dismiss: async () => {},
    })
    render(<HostKeyPromptDialog />)

    expect(screen.getByText('主机指纹已变化')).toBeInTheDocument()
    expect(screen.getByText('SHA256:old')).toBeInTheDocument()
    expect(screen.getByText('SHA256:new')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '信任新指纹并连接' }))

    expect(decide).toHaveBeenCalledWith(true)
    expect(useHostKeyPromptDialog.getState().active).toBeNull()
  })

  it('keeps the prompt actionable when fail-closed dismissal also fails', async () => {
    presentPrompt({
      decide: async () => { throw new Error('decision boom') },
      dismiss: async () => { throw new Error('dismiss boom') },
    })
    render(<HostKeyPromptDialog />)

    await userEvent.click(screen.getByRole('button', { name: '信任并连接' }))
    await waitFor(() => expect(screen.getByText('decision boom')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '关闭' }))

    await waitFor(() => expect(screen.getByText('dismiss boom')).toBeInTheDocument())
    expect(useHostKeyPromptDialog.getState().active?.prompt.attemptId).toBe('attempt-1')
    expect(useHostKeyPromptDialog.getState().pending).toBe(false)
    expect(screen.getByRole('button', { name: '拒绝' })).toBeEnabled()
  })
})

function presentPrompt(overrides: Partial<Pick<HostKeyPromptRequest, 'decide' | 'dismiss'>> = {}) {
  useHostKeyPromptDialog.getState().present({
    coordinatorId: 1,
    prompt: {
      attemptId: 'attempt-1',
      hostname: 'host.internal:2222',
      fingerprint: 'SHA256:test',
      algorithm: 'ssh-ed25519',
      changed: false,
      expected: [],
    },
    endpoint: { host: 'host.internal', port: 2222 },
    decide: overrides.decide ?? (async () => {}),
    dismiss: overrides.dismiss ?? (async () => {}),
  })
}
