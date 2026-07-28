import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Events } from '@wailsio/runtime'
import { SyncDangerActions } from '@/components/settings/SyncDangerActions'
import { SyncVersionHistory } from '@/components/settings/SyncVersionHistory'
import { SETTINGS_PREVIEW_CANCELLED_EVENT } from '@/lib/settingsWindowEvents'

describe('sync action dialogs', () => {
  it('prevents duplicate local reset submissions', async () => {
    let resolveReset: (() => void) | undefined
    const onReset = vi.fn(() => new Promise<void>((resolve) => { resolveReset = resolve }))
    render(<SyncDangerActions pending={null} masterKeySaved onExport={vi.fn()} onImport={vi.fn()} onReset={onReset} />)

    await userEvent.click(screen.getByRole('button', { name: '清空本地业务数据' }))
    const confirm = screen.getByRole('button', { name: '确认清空' })
    await userEvent.click(confirm)
    expect(confirm).toBeDisabled()
    await userEvent.click(confirm)
    expect(onReset).toHaveBeenCalledOnce()

    await act(async () => { resolveReset?.() })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('closes an unconfirmed local reset when the settings window hides', async () => {
    const onReset = vi.fn(async () => {})
    render(<SyncDangerActions pending={null} masterKeySaved onExport={vi.fn()} onImport={vi.fn()} onReset={onReset} />)

    await userEvent.click(screen.getByRole('button', { name: '清空本地业务数据' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    await act(async () => { await Events.Emit(SETTINGS_PREVIEW_CANCELLED_EVENT, { data: null }) })

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onReset).not.toHaveBeenCalled()
  })

  it('keeps a confirmed local reset running after the settings window hides', async () => {
    let resolveReset: (() => void) | undefined
    const onReset = vi.fn(() => new Promise<void>((resolve) => { resolveReset = resolve }))
    render(<SyncDangerActions pending={null} masterKeySaved onExport={vi.fn()} onImport={vi.fn()} onReset={onReset} />)

    await userEvent.click(screen.getByRole('button', { name: '清空本地业务数据' }))
    await userEvent.click(screen.getByRole('button', { name: '确认清空' }))
    await act(async () => { await Events.Emit(SETTINGS_PREVIEW_CANCELLED_EVENT, { data: null }) })

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onReset).toHaveBeenCalledOnce()
    await act(async () => { resolveReset?.() })
    await waitFor(() => expect(screen.getByRole('button', { name: '清空本地业务数据' })).toBeEnabled())
  })

  it('keeps the version operation lease across list refreshes', async () => {
    let resolveFirst: (() => void) | undefined
    const onRestore = vi.fn((id: number) => new Promise<void>((resolve) => {
      if (id === 1) resolveFirst = resolve
      else resolve()
    }))
    const view = render(<SyncVersionHistory versions={[version(1), version(2)]} pending={null} onRestore={onRestore} onDelete={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: '恢复版本 1' }))
    await userEvent.click(screen.getByRole('button', { name: '确认恢复' }))
    expect(screen.getByRole('button', { name: '确认恢复' })).toBeDisabled()

    view.rerender(<SyncVersionHistory versions={[version(2)]} pending={null} onRestore={onRestore} onDelete={vi.fn()} />)
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    const nextRestore = screen.getByRole('button', { name: '恢复版本 2' })
    expect(nextRestore).toBeDisabled()
    await userEvent.click(nextRestore)
    expect(onRestore).toHaveBeenCalledOnce()

    await act(async () => { resolveFirst?.() })
    await waitFor(() => expect(nextRestore).toBeEnabled())
    await userEvent.click(nextRestore)
    await userEvent.click(screen.getByRole('button', { name: '确认恢复' }))
    expect(onRestore).toHaveBeenCalledTimes(2)
  })

  it('closes an unconfirmed version action when the settings window hides', async () => {
    const onRestore = vi.fn(async () => {})
    render(<SyncVersionHistory versions={[version(1)]} pending={null} onRestore={onRestore} onDelete={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: '恢复版本 1' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    await act(async () => { await Events.Emit(SETTINGS_PREVIEW_CANCELLED_EVENT, { data: null }) })

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onRestore).not.toHaveBeenCalled()
  })

  it('keeps a confirmed version restore running after the settings window hides', async () => {
    let resolveRestore: (() => void) | undefined
    const onRestore = vi.fn(() => new Promise<void>((resolve) => { resolveRestore = resolve }))
    render(<SyncVersionHistory versions={[version(1)]} pending={null} onRestore={onRestore} onDelete={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: '恢复版本 1' }))
    await userEvent.click(screen.getByRole('button', { name: '确认恢复' }))
    await act(async () => { await Events.Emit(SETTINGS_PREVIEW_CANCELLED_EVENT, { data: null }) })

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onRestore).toHaveBeenCalledOnce()
    await act(async () => { resolveRestore?.() })
    await waitFor(() => expect(screen.getByRole('button', { name: '恢复版本 1' })).toBeEnabled())
  })
})

function version(id: number) {
  return { id, version_id: `version-${id}`, version_number: id, parent_version_id: '', snapshot_fingerprint: '', provider: 'gist', source: 'local', file_name: '', size_bytes: 10, protected: false, created_at: '' } as never
}
