import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Dialogs } from '@wailsio/runtime'

const actions = vi.hoisted(() => ({
  exportSessionsCSV: vi.fn(async () => ({ count: 2, included_passwords: true })),
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
    vi.spyOn(Dialogs, 'SaveFile').mockResolvedValue('/tmp/sessions')
    vi.spyOn(Dialogs, 'OpenFile').mockResolvedValue('/tmp/import.csv')
  })

  it('exports selected sessions and warns before including plaintext passwords', async () => {
    render(<SessionCSVTransferActions selectedIDs={['3', '5']} />)
    await userEvent.click(screen.getByRole('button', { name: '导出' }))
    await userEvent.click(screen.getByRole('button', { name: '已选 2 项' }))
    await userEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByText(/密码将以明文写入 CSV/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /选择位置并导出/ }))

    await waitFor(() => expect(actions.exportSessionsCSV).toHaveBeenCalledWith({ path: '/tmp/sessions.csv', sessionIDs: ['3', '5'], includePasswords: true }))
    expect(Dialogs.SaveFile).toHaveBeenCalledWith(expect.objectContaining({ Title: '导出 SSH 会话 CSV' }))
  })

  it('imports with overwrite policy and prioritizes failed row details', async () => {
    render(<SessionCSVTransferActions selectedIDs={[]} />)
    await userEvent.click(screen.getByRole('button', { name: '导入' }))
    await userEvent.click(screen.getByRole('button', { name: '覆盖重复项' }))
    await userEvent.click(screen.getByRole('button', { name: /选择 CSV 并导入/ }))

    await waitFor(() => expect(actions.importSessionsCSV).toHaveBeenCalledWith('/tmp/import.csv', 'overwrite'))
    expect(screen.getByText('处理 2 行，最多展示 100 条明细，失败项优先。')).toBeInTheDocument()
    expect(screen.getByText('key was not found')).toBeInTheDocument()
    expect(screen.getAllByText('新增')).toHaveLength(2)
  })

  it('treats a cancelled import dialog as a no-op', async () => {
    vi.spyOn(Dialogs, 'OpenFile').mockResolvedValue(null as never)
    render(<SessionCSVTransferActions selectedIDs={[]} />)
    await userEvent.click(screen.getByRole('button', { name: '导入' }))
    await userEvent.click(screen.getByRole('button', { name: /选择 CSV 并导入/ }))
    expect(actions.importSessionsCSV).not.toHaveBeenCalled()
  })
})
