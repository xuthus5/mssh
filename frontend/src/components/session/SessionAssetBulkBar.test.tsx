import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionAssetBulkBar } from '@/components/session/SessionAssetBulkBar'
import { useToastStore } from '@/components/ui/toast'

describe('SessionAssetBulkBar', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
  })

  it('confirms the target count and clears environments transactionally', async () => {
    const setEnvironment = vi.fn(async () => 2)
    const clear = vi.fn()
    render(<SessionAssetBulkBar selectedIDs={['1', '2']} environments={[]} projects={[]} tags={[]} onSetEnvironment={setEnvironment} onSetProject={vi.fn()} onUpdateTags={vi.fn()} onClearSelection={clear} />)
    await userEvent.click(screen.getByRole('button', { name: '环境' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('本次操作将影响 2 个会话')
    await userEvent.click(screen.getByRole('button', { name: '确认更新 2 个会话' }))
    expect(setEnvironment).toHaveBeenCalledWith(['1', '2'], null)
    expect(clear).toHaveBeenCalled()
  })

  it('keeps selection and exposes backend errors', async () => {
    const setProject = vi.fn(async () => { throw new Error('事务回滚') })
    const clear = vi.fn()
    render(<SessionAssetBulkBar selectedIDs={['1']} environments={[]} projects={[]} tags={[]} onSetEnvironment={vi.fn()} onSetProject={setProject} onUpdateTags={vi.fn()} onClearSelection={clear} />)
    await userEvent.click(screen.getByRole('button', { name: '项目' }))
    await userEvent.click(screen.getByRole('button', { name: '确认更新 1 个会话' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('事务回滚')
    expect(useToastStore.getState().toasts).toHaveLength(0)
    expect(clear).not.toHaveBeenCalled()
  })

  it('adds selected tags in bulk', async () => {
	const updateTags = vi.fn(async () => 1)
	render(<SessionAssetBulkBar selectedIDs={['1']} environments={[]} projects={[]} tags={[{ id: 'tag', name: '核心', colorToken: 'red', sessionCount: 1 }]} onSetEnvironment={vi.fn()} onSetProject={vi.fn()} onUpdateTags={updateTags} onClearSelection={vi.fn()} />)
	await userEvent.click(screen.getByRole('button', { name: '标签' }))
	await userEvent.click(screen.getByRole('button', { name: '选择标签' }))
	await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: '核心' }))
	await userEvent.click(screen.getByRole('button', { name: '确认更新 1 个会话' }))
	expect(updateTags).toHaveBeenCalledWith(['1'], ['tag'], 'add')
  })

  it('keeps the old batch lease while selection changes', async () => {
    const pending = deferred<number>()
    const update = vi.fn()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(1)
    const clear = vi.fn()
    const view = render(<SessionAssetBulkBar selectedIDs={['1']} environments={[]} projects={[]} tags={[]} onSetEnvironment={update} onSetProject={vi.fn()} onUpdateTags={vi.fn()} onClearSelection={clear} />)
    await userEvent.click(screen.getByRole('button', { name: '环境' }))
    await userEvent.click(screen.getByRole('button', { name: '确认更新 1 个会话' }))
    view.rerender(<SessionAssetBulkBar selectedIDs={['2']} environments={[]} projects={[]} tags={[]} onSetEnvironment={update} onSetProject={vi.fn()} onUpdateTags={vi.fn()} onClearSelection={clear} />)

    expect(screen.getByRole('button', { name: '处理中…' })).toBeDisabled()
    expect(screen.getByRole('combobox')).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await act(async () => pending.resolve(1))

    expect(screen.getByRole('button', { name: '确认更新 1 个会话' })).toBeEnabled()
    expect(clear).not.toHaveBeenCalled()
    expect(useToastStore.getState().toasts).toHaveLength(0)
    await userEvent.click(screen.getByRole('button', { name: '确认更新 1 个会话' }))
    expect(update).toHaveBeenNthCalledWith(2, ['2'], null)
  })

  it('deduplicates rapid bulk updates', async () => {
    const pending = deferred<number>()
    const update = vi.fn(() => pending.promise)
    render(<SessionAssetBulkBar selectedIDs={['1']} environments={[]} projects={[]} tags={[]} onSetEnvironment={update} onSetProject={vi.fn()} onUpdateTags={vi.fn()} onClearSelection={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: '环境' }))
    const confirm = screen.getByRole('button', { name: '确认更新 1 个会话' })
    act(() => {
      fireEvent.click(confirm)
      fireEvent.click(confirm)
    })
    expect(update).toHaveBeenCalledOnce()
    await act(async () => pending.resolve(1))
  })

  it('closes a stale bulk dialog when selection is cleared', async () => {
    const view = render(<SessionAssetBulkBar selectedIDs={['1']} environments={[]} projects={[]} tags={[]} onSetEnvironment={vi.fn()} onSetProject={vi.fn()} onUpdateTags={vi.fn()} onClearSelection={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: '环境' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    view.rerender(<SessionAssetBulkBar selectedIDs={[]} environments={[]} projects={[]} tags={[]} onSetEnvironment={vi.fn()} onSetProject={vi.fn()} onUpdateTags={vi.fn()} onClearSelection={vi.fn()} />)
    await act(async () => { await Promise.resolve() })
    view.rerender(<SessionAssetBulkBar selectedIDs={['2']} environments={[]} projects={[]} tags={[]} onSetEnvironment={vi.fn()} onSetProject={vi.fn()} onUpdateTags={vi.fn()} onClearSelection={vi.fn()} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
