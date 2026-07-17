import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SessionAssetFilterBar } from '@/components/session/SessionAssetFilterBar'
import { emptySessionAssetFilters } from '@/lib/sessionAssetSearch'

describe('SessionAssetFilterBar', () => {
  it('renders removable chips with keyboard-accessible controls', async () => {
    const onChange = vi.fn()
    render(<SessionAssetFilterBar filters={{ ...emptySessionAssetFilters, query: 'db', environmentIds: ['env'], includeUntagged: true }} environments={[{ id: 'env', name: '生产', colorToken: 'red', sortOrder: 0, sessionCount: 1 }]} projects={[]} tags={[]} onChange={onChange} onReset={vi.fn()} />)
    const remove = screen.getByRole('button', { name: '移除筛选 环境：生产' })
    remove.focus()
    await userEvent.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith({ environmentIds: [] })
    expect(screen.getByText('无标签')).toBeInTheDocument()
  })

  it('opens advanced filtering and exposes unset and notes conditions', async () => {
	const onChange = vi.fn()
	const onReset = vi.fn()
	render(<SessionAssetFilterBar filters={emptySessionAssetFilters} environments={[{ id: 'env', name: '生产', colorToken: 'red', sortOrder: 0, sessionCount: 1 }]} projects={[]} tags={[]} onChange={onChange} onReset={onReset} />)
    await userEvent.click(screen.getByRole('button', { name: '高级筛选' }))
    expect(await screen.findByText('同类条件取并集，不同类别取交集。')).toBeInTheDocument()
    expect(screen.getByText('未设置环境')).toBeInTheDocument()
    expect(screen.getByText('备注关键词（仅显式筛选时匹配）')).toBeInTheDocument()
	await userEvent.click(screen.getByText('生产'))
	await userEvent.click(screen.getByText('未设置环境'))
	await userEvent.type(screen.getByLabelText('最少连接次数'), '3')
	await userEvent.type(screen.getByLabelText('备注关键词（仅显式筛选时匹配）'), '维护')
	expect(onChange).toHaveBeenCalledWith({ environmentIds: ['env'] })
	expect(onChange).toHaveBeenCalledWith({ includeUnsetEnvironment: true })
	expect(onChange).toHaveBeenCalledWith({ minConnections: 3 })
  })
})
