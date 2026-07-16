import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SyncPanel } from '@/components/settings/SyncPanel'

describe('SyncPanel backup master key', () => {
  it('requires and confirms a master key before saving', async () => {
    const onSave = vi.fn()
    render(<SyncPanel sync={{ enabled: false, url: '', username: '', password: '', masterKey: '' }} onSave={onSave} onExport={vi.fn()} onImport={vi.fn()} />)
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('备份主密钥'), 'correct horse battery staple')
    await user.type(screen.getByLabelText('确认备份主密钥'), 'correct horse battery staple')
    await user.click(screen.getByRole('button', { name: '保存主密钥' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ masterKey: 'correct horse battery staple' }))
  })

  it('keeps backup actions disabled without a saved master key', () => {
    render(<SyncPanel sync={{ enabled: false, url: '', username: '', password: '', masterKey: '' }} onSave={vi.fn()} onExport={vi.fn()} onImport={vi.fn()} />)
    expect(screen.getByRole('button', { name: '导出配置' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '导入配置' })).toBeDisabled()
  })
})
