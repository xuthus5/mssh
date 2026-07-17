import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SessionAssetBulkBar } from '@/components/session/SessionAssetBulkBar'

describe('SessionAssetBulkBar', () => {
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
})
