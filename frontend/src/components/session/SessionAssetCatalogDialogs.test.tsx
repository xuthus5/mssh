import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionAssetCatalogDeleteDialog, SessionAssetCatalogEditor } from '@/components/session/SessionAssetCatalogDialogs'
import { useToastStore } from '@/components/ui/toast'

const environmentImpact = vi.fn()
const tagImpact = vi.fn()
vi.mock('@/lib/wails', () => ({
  AssetCatalogService: {
    EnvironmentDeleteImpact: (...args: unknown[]) => environmentImpact(...args),
    ProjectDeleteImpact: vi.fn(),
    TagDeleteImpact: (...args: unknown[]) => tagImpact(...args),
  },
}))

describe('SessionAssetCatalogDialogs', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
    environmentImpact.mockReset()
    tagImpact.mockReset()
    environmentImpact.mockResolvedValue({ name: '生产', session_count: 1 })
    tagImpact.mockResolvedValue({ name: '核心', session_count: 2 })
  })

  it('shows catalog save failures inline without toast', async () => {
    const onCreateEnvironment = vi.fn(async () => {
      throw new Error('save catalog failed')
    })
    render(
      <SessionAssetCatalogEditor
        target={{ kind: 'environment' }}
        onOpenChange={vi.fn()}
        onCreateEnvironment={onCreateEnvironment}
        onCreateProject={vi.fn()}
        onCreateTag={vi.fn()}
        onUpdateEnvironment={vi.fn()}
        onUpdateProject={vi.fn()}
        onUpdateTag={vi.fn()}
      />,
    )
    await userEvent.type(screen.getByRole('textbox'), '生产')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('save catalog failed')
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('shows delete impact load failures inline without toast', async () => {
    environmentImpact.mockRejectedValueOnce(new Error('impact failed'))
    render(
      <SessionAssetCatalogDeleteDialog
        target={{ kind: 'environment', item: { id: '1', name: '生产', colorToken: 'red', sortOrder: 0, sessionCount: 1 } }}
        environments={[{ id: '1', name: '生产', colorToken: 'red', sortOrder: 0, sessionCount: 1 }]}
        projects={[]}
        onOpenChange={vi.fn()}
        onDeleteEnvironment={vi.fn()}
        onDeleteProject={vi.fn()}
        onDeleteTag={vi.fn()}
      />,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('impact failed')
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('shows delete failures for tags inline without toast', async () => {
    const onDeleteTag = vi.fn(async () => {
      throw new Error('delete failed')
    })
    render(
      <SessionAssetCatalogDeleteDialog
        target={{ kind: 'tag', item: { id: '9', name: '核心', colorToken: 'red', sessionCount: 2 } }}
        environments={[]}
        projects={[]}
        onOpenChange={vi.fn()}
        onDeleteEnvironment={vi.fn()}
        onDeleteProject={vi.fn()}
        onDeleteTag={onDeleteTag}
      />,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: /确认处理/ })).not.toBeDisabled())
    await userEvent.click(screen.getByRole('button', { name: /确认处理/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('delete failed')
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })
})
