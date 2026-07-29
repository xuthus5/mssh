import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Dialogs } from '@wailsio/runtime'
import { useState } from 'react'
import { useToastStore } from '@/components/ui/toast'

const actions = vi.hoisted(() => ({
  exportSessionsCSV: vi.fn(async () => ({ count: 2, included_passwords: true })),
  previewSessionsCSV: vi.fn(async () => ({
    headers: ['name', 'host', 'port', 'username', 'auth_method', 'password', 'key_name', 'key_public_key', 'folder_path', 'environment', 'project', 'tags', 'notes', 'keep_alive', 'term_type'],
    sample_rows: [['生产服务器', '10.0.0.1', '22', 'root', 'password', '******', '', '', '[]', '', '', '[]', '', '60', 'xterm-256color']],
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
import { useSessionCSVExportDialog } from '@/components/session/useSessionCSVExportDialog'

function ExternallyControlledExportDialog() {
  const [open, setOpen] = useState(true)
  const dialog = useSessionCSVExportDialog({
    open, selectedIDs: [], onOpenChange: setOpen, onExport: actions.exportSessionsCSV,
  })
  return <>
    <button type="button" onClick={() => setOpen(false)}>force-close</button>
    <button type="button" onClick={() => setOpen(true)}>force-open</button>
    {open ? <button type="button" disabled={dialog.pending} onClick={() => { void dialog.runExport() }}>run-export</button> : null}
  </>
}

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

  it('shows export failures inline without toast', async () => {
    actions.exportSessionsCSV.mockRejectedValueOnce(new Error('export boom'))
    render(<SessionCSVTransferActions selectedIDs={[]} />)
    await userEvent.click(screen.getByRole('button', { name: '导出' }))
    await userEvent.click(screen.getByRole('button', { name: /选择位置并导出/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('export boom')
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('closes the export dialog after a successful export', async () => {
    const onExport = actions.exportSessionsCSV
    render(<SessionCSVTransferActions selectedIDs={[]} />)
    await userEvent.click(screen.getByRole('button', { name: '导出' }))
    await userEvent.click(screen.getByRole('button', { name: /选择位置并导出/ }))
    await waitFor(() => expect(onExport).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('snapshots selected sessions before opening the save picker', async () => {
    let resolvePicker: ((path: string) => void) | undefined
    vi.spyOn(Dialogs, 'SaveFile').mockImplementationOnce(() => new Promise((resolve) => { resolvePicker = resolve }))
    const view = render(<SessionCSVTransferActions selectedIDs={['old']} />)
    await userEvent.click(screen.getByRole('button', { name: '导出' }))
    await userEvent.click(screen.getByRole('button', { name: '已选 1 项' }))
    await userEvent.click(screen.getByRole('button', { name: /选择位置并导出/ }))
    view.rerender(<SessionCSVTransferActions selectedIDs={['new']} />)
    await act(async () => { resolvePicker?.('/tmp/snapshotted') })
    await waitFor(() => expect(actions.exportSessionsCSV).toHaveBeenCalledWith(expect.objectContaining({ sessionIDs: ['old'] })))
  })

  it('locks the export draft while the save picker is pending', async () => {
    const picker = deferred<string>()
    vi.spyOn(Dialogs, 'SaveFile').mockImplementationOnce(() => picker.promise)
    render(<SessionCSVTransferActions selectedIDs={['old']} />)
    await userEvent.click(screen.getByRole('button', { name: '导出' }))
    await userEvent.click(screen.getByRole('button', { name: '已选 1 项' }))
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.type(screen.getByLabelText('应用密码确认'), 'app-pass-12')
    await userEvent.click(screen.getByRole('button', { name: /选择位置并导出/ }))

    expect(screen.getByRole('button', { name: '全部会话' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '已选 1 项' })).toBeDisabled()
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByLabelText('应用密码确认')).toBeDisabled()

    await act(async () => { picker.resolve('/tmp/locked-export'); await picker.promise })
    await waitFor(() => expect(actions.exportSessionsCSV).toHaveBeenCalledWith(expect.objectContaining({
      path: '/tmp/locked-export.csv',
      sessionIDs: ['old'],
      confirmPassword: 'app-pass-12',
    })))
  })

  it('locks import mapping and conflict drafts while import is pending', async () => {
    const transfer = deferred<Awaited<ReturnType<typeof actions.importSessionsCSV>>>()
    actions.importSessionsCSV.mockImplementationOnce(() => transfer.promise)
    render(<SessionCSVTransferActions selectedIDs={[]} />)
    await userEvent.click(screen.getByRole('button', { name: '导入' }))
    await userEvent.click(screen.getByRole('button', { name: '选择 CSV 文件' }))
    await userEvent.click(await screen.findByRole('button', { name: '确认导入' }))

    expect(screen.getByRole('button', { name: /MobaXterm/ })).toBeDisabled()
    expect(screen.getByLabelText('会话名称外部表头')).toBeDisabled()
    expect(screen.getByLabelText('会话名称默认值')).toBeDisabled()
    expect(screen.getByLabelText('重复会话处理')).toBeDisabled()

    await act(async () => {
      transfer.resolve({ total: 1, imported: 1, updated: 0, skipped: 0, failed: 0, results: [] })
      await transfer.promise
    })
    expect(await screen.findByText('处理 1 行，最多展示 100 条明细，失败项优先。')).toBeInTheDocument()
  })

  it('opens only one save picker for rapid export clicks', async () => {
    const picker = deferred<string>()
    vi.spyOn(Dialogs, 'SaveFile').mockImplementationOnce(() => picker.promise)
    render(<SessionCSVTransferActions selectedIDs={[]} />)
    await userEvent.click(screen.getByRole('button', { name: '导出' }))
    const submit = screen.getByRole('button', { name: /选择位置并导出/ })
    act(() => {
      fireEvent.click(submit)
      fireEvent.click(submit)
    })
    expect(Dialogs.SaveFile).toHaveBeenCalledOnce()
    await act(async () => picker.resolve('/tmp/once'))
    await waitFor(() => expect(actions.exportSessionsCSV).toHaveBeenCalledOnce())
  })

  it('shares the native picker lease across import and export actions', async () => {
    const picker = deferred<string>()
    vi.spyOn(Dialogs, 'SaveFile').mockImplementationOnce(() => picker.promise)
    render(<SessionCSVTransferActions selectedIDs={[]} />)
    await userEvent.click(screen.getByRole('button', { name: '导出' }))
    await userEvent.click(screen.getByRole('button', { name: /选择位置并导出/ }))

    expect(screen.getByText('导入').closest('button')).toBeDisabled()
    expect(screen.getByText('导出').closest('button')).toBeDisabled()

    await act(async () => picker.resolve('/tmp/shared-lease'))
    await waitFor(() => expect(actions.exportSessionsCSV).toHaveBeenCalledOnce())
  })

  it('retains the picker lease across unmount and ignores the stale path', async () => {
    const picker = deferred<string>()
    vi.spyOn(Dialogs, 'SaveFile').mockImplementationOnce(() => picker.promise)
    const previous = render(<SessionCSVTransferActions selectedIDs={['old']} />)
    await userEvent.click(screen.getByRole('button', { name: '导出' }))
    await userEvent.click(screen.getByRole('button', { name: /选择位置并导出/ }))
    previous.unmount()

    render(<SessionCSVTransferActions selectedIDs={['new']} />)
    const importButton = screen.getByRole('button', { name: '导入' })
    expect(importButton).toBeDisabled()

    await act(async () => picker.resolve('/tmp/stale'))
    await waitFor(() => expect(importButton).toBeEnabled())
    expect(actions.exportSessionsCSV).not.toHaveBeenCalled()

    await userEvent.click(importButton)
    await userEvent.click(screen.getByRole('button', { name: '选择 CSV 文件' }))
    await waitFor(() => expect(actions.previewSessionsCSV).toHaveBeenCalledWith('/tmp/import.csv'))
  })

  it('retains the lease while a confirmed import finishes after unmount', async () => {
    const transfer = deferred<Awaited<ReturnType<typeof actions.importSessionsCSV>>>()
    actions.importSessionsCSV.mockImplementationOnce(() => transfer.promise)
    const previous = render(<SessionCSVTransferActions selectedIDs={[]} />)
    await userEvent.click(screen.getByRole('button', { name: '导入' }))
    await userEvent.click(screen.getByRole('button', { name: '选择 CSV 文件' }))
    await userEvent.click(await screen.findByRole('button', { name: '确认导入' }))
    previous.unmount()

    render(<SessionCSVTransferActions selectedIDs={[]} />)
    const exportButton = screen.getByRole('button', { name: '导出' })
    expect(exportButton).toBeDisabled()

    await act(async () => transfer.resolve({ total: 1, imported: 1, updated: 0, skipped: 0, failed: 0, results: [] }))
    await waitFor(() => expect(exportButton).toBeEnabled())
  })

  it('keeps an externally reopened export dialog locked until the picker settles', async () => {
    const picker = deferred<string>()
    vi.spyOn(Dialogs, 'SaveFile').mockImplementationOnce(() => picker.promise)
    render(<ExternallyControlledExportDialog />)
    await userEvent.click(screen.getByRole('button', { name: 'run-export' }))
    await userEvent.click(screen.getByRole('button', { name: 'force-close' }))
    await userEvent.click(screen.getByRole('button', { name: 'force-open' }))

    const reopenedSubmit = screen.getByRole('button', { name: 'run-export' })
    const disabledWhilePickerPending = reopenedSubmit.hasAttribute('disabled')
    await act(async () => { picker.resolve('/tmp/stale'); await picker.promise })
    await waitFor(() => expect(reopenedSubmit).toBeEnabled())

    expect(disabledWhilePickerPending).toBe(true)
    expect(actions.exportSessionsCSV).not.toHaveBeenCalled()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
