import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SessionAssetFields } from '@/components/session/SessionAssetFields'

function props() {
  return {
    environments: [], projects: [], tags: [{ id: 'tag', name: '核心', colorToken: 'red' as const, sessionCount: 0 }],
    environmentId: '', projectId: '', tagIds: [] as string[], notes: '', onEnvironmentChange: vi.fn(), onProjectChange: vi.fn(),
    onTagIdsChange: vi.fn(), onNotesChange: vi.fn(),
    onCreateEnvironment: vi.fn(async (name: string) => ({ id: 'env', name, colorToken: 'slate' as const, sortOrder: 0, sessionCount: 0 })),
    onCreateProject: vi.fn(), onCreateTag: vi.fn(),
  }
}

describe('SessionAssetFields', () => {
  it('explicitly creates an environment and selects it', async () => {
    const values = props()
    render(<SessionAssetFields {...values} />)
    await userEvent.click(screen.getAllByRole('button', { name: /新建/ })[0])
    await userEvent.type(screen.getByRole('textbox', { name: '名称' }), '生产')
    await userEvent.click(screen.getByRole('button', { name: '创建' }))
    expect(values.onCreateEnvironment).toHaveBeenCalledWith('生产', 'slate')
    expect(values.onEnvironmentChange).toHaveBeenCalledWith('env')
  })

  it('shows selected tags as removable badges', async () => {
    const values = { ...props(), tagIds: ['tag'] }
    render(<SessionAssetFields {...values} />)
    expect(screen.getByText('核心')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '移除标签 核心' }))
    expect(values.onTagIdsChange).toHaveBeenCalledWith([])
  })

  it('keeps the quick-create dialog open and reports errors', async () => {
    const values = props()
    values.onCreateEnvironment.mockRejectedValueOnce(new Error('名称重复'))
    render(<SessionAssetFields {...values} />)
    await userEvent.click(screen.getAllByRole('button', { name: /新建/ })[0])
    await userEvent.type(screen.getByRole('textbox', { name: '名称' }), '重复')
    await userEvent.click(screen.getByRole('button', { name: '创建' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('名称重复')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
