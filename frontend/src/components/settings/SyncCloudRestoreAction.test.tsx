import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SyncCloudRestoreAction } from '@/components/settings/SyncCloudRestoreAction'
import { createSyncInput } from '@/lib/cloudSyncForm'
import { SyncProvider, SyncStrategy } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

const input = createSyncInput({
  enabled: true,
  provider: SyncProvider.SyncProviderGist,
  strategy: SyncStrategy.SyncStrategySmart,
  interval_minutes: 15,
  retention_count: 30,
  retention_days: 90,
  gist: { gist_id: 'gist-1', token_saved: true },
  webdav: { url: '', username: '', password_saved: false },
  s3: { endpoint: '', region: 'us-east-1', bucket: '', prefix: '', access_key_id: '', secret_key_saved: false, path_style: false },
} as never)

async function openRestore() {
  await userEvent.click(screen.getByRole('button', { name: '从云端恢复此设备' }))
}

describe('SyncCloudRestoreAction', () => {
  it('joins the cloud backup with the source device password', async () => {
    const onJoin = vi.fn(async () => {})
    render(<SyncCloudRestoreAction input={input} disabled={false} onJoin={onJoin} />)

    await openRestore()
    expect(screen.getByRole('dialog')).toHaveTextContent('此操作会使用云端备份内嵌的 Vault 替换本机 Vault')
    await userEvent.type(screen.getByLabelText('备份设备的应用密码'), 'source-password-12')
    await userEvent.click(screen.getByRole('button', { name: '确认恢复' }))

    await waitFor(() => expect(onJoin).toHaveBeenCalledWith(input, 'source-password-12'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('requires an application password before restoring', async () => {
    const onJoin = vi.fn(async () => {})
    render(<SyncCloudRestoreAction input={input} disabled={false} onJoin={onJoin} />)

    await openRestore()
    await userEvent.click(screen.getByRole('button', { name: '确认恢复' }))

    expect(screen.getByText('请输入应用密码')).toBeInTheDocument()
    expect(onJoin).not.toHaveBeenCalled()
  })

  it('keeps the dialog open and shows restore failures', async () => {
    const onJoin = vi.fn(async () => { throw new Error('invalid application password') })
    render(<SyncCloudRestoreAction input={input} disabled={false} onJoin={onJoin} />)

    await openRestore()
    await userEvent.type(screen.getByLabelText('备份设备的应用密码'), 'wrong-password-12')
    await userEvent.click(screen.getByRole('button', { name: '确认恢复' }))

    expect(await screen.findByText('从云端恢复失败: invalid application password')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('prevents duplicate restore submissions', async () => {
    let resolveJoin: (() => void) | undefined
    const onJoin = vi.fn(() => new Promise<void>((resolve) => { resolveJoin = resolve }))
    render(<SyncCloudRestoreAction input={input} disabled={false} onJoin={onJoin} />)

    await openRestore()
    await userEvent.type(screen.getByLabelText('备份设备的应用密码'), 'source-password-12')
    await userEvent.click(screen.getByRole('button', { name: '确认恢复' }))
    const button = screen.getByRole('button', { name: '恢复中…' })
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(onJoin).toHaveBeenCalledOnce()

    await act(async () => { resolveJoin?.() })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('disables the restore entry while sync configuration is unavailable', () => {
    render(<SyncCloudRestoreAction input={input} disabled onJoin={vi.fn(async () => {})} />)
    expect(screen.getByRole('button', { name: '从云端恢复此设备' })).toBeDisabled()
  })
})
