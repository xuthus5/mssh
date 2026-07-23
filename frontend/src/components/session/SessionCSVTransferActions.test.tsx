import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Dialogs } from '@wailsio/runtime'
import { useToastStore } from '@/components/ui/toast'

const actions = vi.hoisted(() => ({
  exportSessionsCSV: vi.fn(async () => ({ count: 2, included_passwords: true })),
  previewSessionsCSV: vi.fn(async () => ({
    headers: ['name', 'host', 'port', 'username', 'auth_method', 'password', 'key_name', 'key_public_key', 'folder_path', 'environment', 'project', 'tags', 'notes', 'keep_alive', 'term_type', 'format_version'],
    sample_rows: [['生产服务器', '10.0.0.1', '22', 'root', 'password', '******', '', '', '[]', '', '', '[]', '', '60', 'xterm-256color', '1']],
    total_rows: 2,
  })),
  importSessionsCSV: vi.fn(async () => ({
    total: 2, imported: 1, updated: 0, skipped: 0, failed: 1,
    results: [
      { row: 2, name: '生产服务器', host: '10.0.0.1', status: 'imported', session_id: 7, error: '' },
      { row: 3, name: '缺少密钥', host: '10.0.0.2', status: 'failed', session_id: 0, error: 'key was not found' },
    ],
  })),
}))
vi.mock('@/hooks/SessionWorkspaceContext', () => ({ useSessionWorkspace: () => actions }))

import { SessionCSVTransferActions } from '@/components/session/SessionCSVTransferActions'

describe('SessionCSVTransferActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useToastStore.setState({ toasts: [] })
    vi.spyOn(Dialogs, 'SaveFile').mockResolvedValue('/tmp/sessions')
    vi.spyOn(Dialogs, 'OpenFile').mockResolvedValue('/tmp/import.csv')
  })

  it('exports selected sessions and warns before including plaintext passwords', async () => {
    render(<SessionCSVTransferActions selectedIDs={['3', '5']} />)
    await userEvent.click(screen.getByRole('button', { name: '导出' }))
    await userEvent.click(screen.getByRole('button', { name: '已选 2 项' }))
    await userEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByText(/密码将以明文写入 CSV/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /选择位置并导出/ })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('应用密码确认'), 'app-pass-12')
    await userEvent.click(screen.getByRole('button', { name: /选择位置并导出/ }))

    await waitFor(() => expect(actions.exportSessionsCSV).toHaveBeenCalledWith({
      path: '/tmp/sessions.csv', sessionIDs: ['3', '5'], includePasswords: true, confirmPassword: 'app-pass-12',
    }))
    expect(Dialogs.SaveFile).toHaveBeenCalledWith(expect.objectContaining({ Title: '导出 SSH 会话 CSV' }))
  })

  it('previews, maps, and imports sessions while prioritizing failed row details', async () => {
    render(<SessionCSVTransferActions selectedIDs={[]} />)
    await userEvent.click(screen.getByRole('button', { name: '导入' }))
    await userEvent.click(screen.getByRole('button', { name: '选择 CSV 文件' }))
    expect(await screen.findByText('字段映射')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '确认导入' }))

    await waitFor(() => expect(actions.previewSessionsCSV).toHaveBeenCalledWith('/tmp/import.csv'))
    expect(actions.importSessionsCSV).toHaveBeenCalledWith(expect.objectContaining({ path: '/tmp/import.csv', conflictPolicy: 'skip' }))
    expect(screen.getByText('处理 2 行，最多展示 100 条明细，失败项优先。')).toBeInTheDocument()
    expect(screen.getByText('key was not found')).toBeInTheDocument()
    expect(screen.getAllByText('新增')).toHaveLength(2)
  })

  it('treats a cancelled import dialog as a no-op', async () => {
    vi.spyOn(Dialogs, 'OpenFile').mockResolvedValue(null as never)
    render(<SessionCSVTransferActions selectedIDs={[]} />)
    await userEvent.click(screen.getByRole('button', { name: '导入' }))
    await userEvent.click(screen.getByRole('button', { name: /选择 CSV 文件/ }))
    expect(actions.importSessionsCSV).not.toHaveBeenCalled()
  })

  it('switches one-click client templates and guards required mappings', async () => {
    actions.previewSessionsCSV.mockResolvedValueOnce({
      headers: ['Bookmark', 'Remote host', 'Username', 'Description'],
      sample_rows: [['ops', '10.0.0.8', 'root', 'operations']],
      total_rows: 1,
    })
    render(<SessionCSVTransferActions selectedIDs={[]} />)
    await userEvent.click(screen.getByRole('button', { name: '导入' }))
    await userEvent.click(screen.getByRole('button', { name: '选择 CSV 文件' }))
    expect(await screen.findByRole('button', { name: /MobaXterm/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认导入' })).not.toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: /PuTTY/ }))
    expect(screen.getByRole('button', { name: '确认导入' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: /MobaXterm/ }))
    expect(screen.getByRole('button', { name: '确认导入' })).not.toBeDisabled()
  })
})

  it('toasts export failures', async () => {
    actions.exportSessionsCSV.mockRejectedValueOnce(new Error('export boom'))
    render(<SessionCSVTransferActions selectedIDs={[]} />)
    await userEvent.click(screen.getByRole('button', { name: '导出' }))
    await userEvent.click(screen.getByRole('button', { name: /选择位置并导出/ }))
    await waitFor(() => expect(useToastStore.getState().toasts.some((item) => item.message.includes('export boom'))).toBe(true))
    expect(await screen.findByRole('alert')).toHaveTextContent('export boom')
  })
