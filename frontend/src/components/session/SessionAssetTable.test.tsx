import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SessionAssetDetailPanel } from '@/components/session/SessionAssetDetailPanel'
import { SessionAssetTable } from '@/components/session/SessionAssetTable'
import type { Session } from '@/hooks/useSession'

const session: Session = {
  id: '1', name: '生产数据库', host: 'db.internal', port: 22, username: 'root', authMethod: 'agent', keepAlive: 30,
  termType: 'xterm', folderId: 'folder', notes: '完整备注', environmentId: 'env', projectId: 'project',
  environment: { id: 'env', name: '生产', colorToken: 'red', sortOrder: 0, sessionCount: 1 },
  project: { id: 'project', name: '支付', code: 'PAY', description: '', sortOrder: 0, sessionCount: 1 },
  tags: [
    { id: 'a', name: '核心', colorToken: 'red', sessionCount: 1 },
    { id: 'b', name: '数据库', colorToken: 'blue', sessionCount: 1 },
    { id: 'c', name: 'Linux', colorToken: 'green', sessionCount: 1 },
  ], connectionCount: 8, lastConnectedAt: '2026-07-10T00:00:00Z',
}

function tableProps() {
  return {
    sessions: [session], folders: [{ id: 'folder', name: '核心分组', parentId: null, isDefault: true }], selectedIDs: new Set<string>(),
    onSelectionChange: vi.fn(), onConnect: vi.fn(), onOpenDetail: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(),
  }
}

describe('SessionAssetTable', () => {
  it('renders metadata and routes pointer and keyboard actions', async () => {
    const props = tableProps()
    render(<SessionAssetTable {...props} />)
    expect(screen.getByText('生产')).toBeInTheDocument()
    expect(screen.getByText('PAY')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.getByText('核心分组')).toBeInTheDocument()
    const row = screen.getByRole('row', { name: /生产数据库/ })
    await userEvent.click(row)
    expect(props.onOpenDetail).toHaveBeenCalledWith(session)
    fireEvent.doubleClick(row)
    expect(props.onConnect).toHaveBeenCalledWith('1')
    fireEvent.keyDown(row, { key: 'Enter', ctrlKey: true })
    expect(props.onConnect).toHaveBeenCalledTimes(2)
  })

  it('isolates checkbox selection from row activation', async () => {
    const props = tableProps()
    render(<SessionAssetTable {...props} />)
    await userEvent.click(screen.getByRole('checkbox', { name: '选择 生产数据库' }))
    expect(props.onSelectionChange).toHaveBeenCalledWith(new Set(['1']))
    expect(props.onOpenDetail).not.toHaveBeenCalled()
    expect(props.onConnect).not.toHaveBeenCalled()
  })
})

describe('SessionAssetDetailPanel', () => {
  it('shows complete details and enables terminal duplication only when active', async () => {
    const duplicate = vi.fn()
    const { rerender } = render(<SessionAssetDetailPanel session={session} folders={[{ id: 'folder', name: '核心分组', parentId: null, isDefault: true }]} activeTerminalCount={0} onClose={vi.fn()} onConnect={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onDuplicateTerminal={duplicate} />)
    expect(screen.getByText('完整备注')).toBeInTheDocument()
    expect(screen.getByText('8 次')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /复制终端/ })).toBeDisabled()
    rerender(<SessionAssetDetailPanel session={session} folders={[]} activeTerminalCount={2} onClose={vi.fn()} onConnect={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onDuplicateTerminal={duplicate} />)
    await userEvent.click(screen.getByRole('button', { name: /复制终端/ }))
    expect(duplicate).toHaveBeenCalledWith(session)
  })
})
