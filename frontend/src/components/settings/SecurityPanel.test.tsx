import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SecurityPanel } from '@/components/settings/SecurityPanel'

const service = vi.hoisted(() => ({ ListHostKeys: vi.fn(), DeleteHostKey: vi.fn() }))
vi.mock('@/lib/wails', () => ({ SessionService: service }))

describe('SecurityPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    service.ListHostKeys.mockResolvedValue([{ line: 1, hosts: 'example.com', algorithm: 'ssh-ed25519', fingerprint: 'SHA256:test' }])
    service.DeleteHostKey.mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('lists and deletes trusted host fingerprints', async () => {
    render(<SecurityPanel />)
    expect(await screen.findByText('example.com')).toBeInTheDocument()
    expect(screen.getByText(/SHA256:test/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '删除 example.com 的主机指纹' }))
    expect(service.DeleteHostKey).toHaveBeenCalledWith(1)
  })

  it('renders an empty trusted host state', async () => {
    service.ListHostKeys.mockResolvedValue([])
    render(<SecurityPanel />)
    expect(await screen.findByText('尚未信任任何 SSH 主机。')).toBeInTheDocument()
  })
})
