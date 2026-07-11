import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FolderManager } from '@/components/settings/FolderManager'

describe('FolderManager', () => {
  it('protects the default folder and can set another folder as default', async () => {
    const onSetDefault = vi.fn(async () => {})
    render(<FolderManager
      folders={[
        { id: '1', name: '默认分组', parentId: null, isDefault: true },
        { id: '2', name: '生产环境', parentId: null, isDefault: false },
      ]}
      sessions={[]}
      onCreate={vi.fn(async () => undefined)}
      onRename={vi.fn(async () => {})}
      onSetDefault={onSetDefault}
      onDelete={vi.fn(async () => {})}
    />)
    expect(screen.getByRole('button', { name: '删除分组' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '生产环境' }))
    await userEvent.click(screen.getByRole('button', { name: '设为默认' }))
    expect(onSetDefault).toHaveBeenCalledWith('2')
  })
})
