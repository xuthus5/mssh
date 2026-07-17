import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SyncPanel } from '@/components/settings/SyncPanel'

describe('SyncPanel backup master key', () => {
  const cloudProps = { onTestCloud: vi.fn(async () => {}), onPushCloud: vi.fn(async () => {}), onPullCloud: vi.fn(async () => {}) }

  it('requires and confirms a master key before saving', async () => {
    const onSave = vi.fn()
    render(<SyncPanel sync={{ enabled: false, url: '', username: '', password: '', masterKey: '' }} onSave={onSave} onExport={vi.fn()} onImport={vi.fn()} {...cloudProps} />)
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('备份主密钥'), 'correct horse battery staple')
    await user.type(screen.getByLabelText('确认备份主密钥'), 'correct horse battery staple')
    await user.click(screen.getByRole('button', { name: '保存主密钥' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ masterKey: 'correct horse battery staple' }))
  })

  it('keeps backup actions disabled without a saved master key', () => {
    render(<SyncPanel sync={{ enabled: false, url: '', username: '', password: '', masterKey: '' }} onSave={vi.fn()} onExport={vi.fn()} onImport={vi.fn()} {...cloudProps} />)
    expect(screen.getByRole('button', { name: '导出配置' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '导入配置' })).toBeDisabled()
  })

  it('runs cloud actions with the current encrypted sync configuration', async () => {
    const onPushCloud = vi.fn(async () => {})
    render(<SyncPanel sync={{ enabled: true, url: 'https://sync.example/backup', username: 'alice', password: '', masterKey: 'correct horse battery staple' }} onSave={vi.fn()} onExport={vi.fn()} onImport={vi.fn()} {...cloudProps} onPushCloud={onPushCloud} />)

    await userEvent.type(screen.getByLabelText('密码'), 'secret')
    await userEvent.click(screen.getByRole('button', { name: '上传到云端' }))

    expect(onPushCloud).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://sync.example/backup', username: 'alice', password: 'secret', masterKey: 'correct horse battery staple' }))
  })

  it('shows the last synchronized backup version', () => {
    render(<SyncPanel sync={{ enabled: true, url: 'https://sync.example/backup', username: '', password: '', masterKey: 'correct horse battery staple', etag: '"v2"', formatVersion: 2, lastDirection: 'download', lastSyncedAt: '2026-07-17T01:02:03Z' }} onSave={vi.fn()} onExport={vi.fn()} onImport={vi.fn()} {...cloudProps} />)
    expect(screen.getByTestId('cloud-sync-version')).toHaveTextContent('备份格式 v2')
    expect(screen.getByTestId('cloud-sync-version')).toHaveTextContent('ETag "v2"')
  })
})
