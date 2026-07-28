import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FileTreeView } from '@/components/file/FileTreeView'
import type { FileInfo } from '@/hooks/useFileTransfer'
import { useToastStore } from '@/components/ui/toast'

const rootFiles: FileInfo[] = [
  { name: '.env', path: '/.env', size: 10, modified: '', isDir: false },
  { name: 'src', path: '/src', size: 0, modified: '', isDir: true },
]

describe('FileTreeView', () => {
  it('filters hidden files and lazily loads expanded directories', async () => {
    const user = userEvent.setup()
    const onLoadDirectory = vi.fn(async () => [{ name: 'main.go', path: '/src/main.go', size: 20, modified: '', isDir: false }])
    render(<FileTreeView currentPath="/" files={rootFiles} loading={false} showHiddenFiles={false} selected={null} onSelect={vi.fn()} onNavigate={vi.fn()} onDownload={vi.fn()} onLoadDirectory={onLoadDirectory} />)

    expect(screen.queryByText('.env')).not.toBeInTheDocument()
    expect(screen.getByText('src')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '展开 src' }))

    expect(onLoadDirectory).toHaveBeenCalledWith('/src')
    expect(await screen.findByText('main.go')).toBeInTheDocument()
  })

  it('shows hidden files when enabled and collapses an expanded directory', async () => {
    const user = userEvent.setup()
    const onLoadDirectory = vi.fn(async () => [])
    render(<FileTreeView currentPath="/" files={rootFiles} loading={false} showHiddenFiles selected={null} onSelect={vi.fn()} onNavigate={vi.fn()} onDownload={vi.fn()} onLoadDirectory={onLoadDirectory} />)

    expect(screen.getByText('.env')).toBeInTheDocument()
    const expand = screen.getByRole('button', { name: '展开 src' })
    await user.click(expand)
    await user.click(screen.getByRole('button', { name: '收起 src' }))
    expect(screen.getByRole('button', { name: '展开 src' })).toBeInTheDocument()
  })

  it('shows inline error when directory load fails and collapses node without toast', async () => {
    const user = userEvent.setup()
    useToastStore.setState({ toasts: [] })
    const onLoadDirectory = vi.fn(async () => { throw new Error('tree load failed') })
    render(<FileTreeView currentPath="/" files={rootFiles} loading={false} showHiddenFiles={false} selected={null} onSelect={vi.fn()} onNavigate={vi.fn()} onDownload={vi.fn()} onLoadDirectory={onLoadDirectory} />)
    await user.click(screen.getByRole('button', { name: '展开 src' }))
    expect(onLoadDirectory).toHaveBeenCalledWith('/src')
    expect(await screen.findByRole('alert')).toHaveTextContent('加载失败')
    expect(screen.getByRole('button', { name: '展开 src' })).toBeInTheDocument()
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('virtualizes large flattened trees above the threshold', () => {
    const files = Array.from({ length: 90 }, (_, index) => ({
      name: `file-${index}.txt`,
      path: `/file-${index}.txt`,
      size: 1,
      modified: '',
      isDir: false,
    }))
    const { container } = render(
      <FileTreeView
        currentPath="/"
        files={files}
        loading={false}
        showHiddenFiles
        selected={null}
        onSelect={vi.fn()}
        onNavigate={vi.fn()}
        onDownload={vi.fn()}
        onLoadDirectory={vi.fn(async () => [])}
      />,
    )
    const treeItems = container.querySelectorAll('[role="treeitem"]')
    // VirtualList only mounts viewport + overscan, not all 90 nodes.
    expect(treeItems.length).toBeGreaterThan(0)
    expect(treeItems.length).toBeLessThan(90)
    expect(screen.getByRole('tree')).toBeInTheDocument()
  })

  it('scrolls a virtualized tree to the item selected by keyboard', async () => {
    const files = Array.from({ length: 90 }, (_, index) => ({
      name: `file-${index}.txt`, path: `/file-${index}.txt`, size: 1, modified: '', isDir: false,
    }))
    const onSelect = vi.fn()
    render(<FileTreeView currentPath="/" files={files} loading={false} showHiddenFiles selected={null}
      onSelect={onSelect} onNavigate={vi.fn()} onDownload={vi.fn()} onLoadDirectory={vi.fn(async () => [])} />)

    const tree = screen.getByRole('tree')
    fireEvent.keyDown(tree, { key: 'End' })

    expect(onSelect).toHaveBeenCalledWith(files[89])
    await waitFor(() => expect(screen.getByText('file-89.txt')).toBeInTheDocument())
    expect(tree).toHaveAttribute('aria-activedescendant', screen.getByText('file-89.txt').closest('[role="treeitem"]')?.id)
  })

  it('keeps the active file identity when an earlier directory expands', async () => {
    const files: FileInfo[] = [
      { name: 'src', path: '/src', size: 0, modified: '', isDir: true },
      { name: 'target.txt', path: '/target.txt', size: 1, modified: '', isDir: false },
    ]
    const onLoadDirectory = vi.fn(async () => [
      { name: 'child.txt', path: '/src/child.txt', size: 1, modified: '', isDir: false },
    ])
    render(<FileTreeView currentPath="/" files={files} loading={false} showHiddenFiles selected={null}
      onSelect={vi.fn()} onNavigate={vi.fn()} onDownload={vi.fn()} onLoadDirectory={onLoadDirectory} />)

    const tree = screen.getByRole('tree')
    fireEvent.keyDown(tree, { key: 'End' })
    await userEvent.click(screen.getByRole('button', { name: '展开 src' }))
    expect(await screen.findByText('child.txt')).toBeInTheDocument()

    const targetItem = screen.getByText('target.txt').closest('[role="treeitem"]')
    expect(tree).toHaveAttribute('aria-activedescendant', targetItem?.id)
  })

  it('does not restore stale children after navigating away and back', async () => {
    let resolveDirectory!: (files: FileInfo[]) => void
    const onLoadDirectory = vi.fn(() => new Promise<FileInfo[]>((resolve) => { resolveDirectory = resolve }))
    const view = render(<FileTreeView currentPath="/" files={rootFiles} loading={false} showHiddenFiles={false} selected={null} onSelect={vi.fn()} onNavigate={vi.fn()} onDownload={vi.fn()} onLoadDirectory={onLoadDirectory} />)
    await userEvent.click(screen.getByRole('button', { name: '展开 src' }))
    view.rerender(<FileTreeView currentPath="/other" files={[{ name: 'other', path: '/other', size: 0, modified: '', isDir: true }]} loading={false} showHiddenFiles={false} selected={null} onSelect={vi.fn()} onNavigate={vi.fn()} onDownload={vi.fn()} onLoadDirectory={onLoadDirectory} />)
    await act(async () => { resolveDirectory([{ name: 'stale.go', path: '/src/stale.go', size: 1, modified: '', isDir: false }]) })
    view.rerender(<FileTreeView currentPath="/" files={rootFiles} loading={false} showHiddenFiles={false} selected={null} onSelect={vi.fn()} onNavigate={vi.fn()} onDownload={vi.fn()} onLoadDirectory={onLoadDirectory} />)
    expect(screen.queryByText('stale.go')).not.toBeInTheDocument()
  })

  it('blocks expansion and navigation for a directory under mutation', async () => {
    const onLoadDirectory = vi.fn(async () => [])
    const onNavigate = vi.fn()
    render(<FileTreeView currentPath="/" files={rootFiles} loading={false} showHiddenFiles={false} selected={null}
      onSelect={vi.fn()} onNavigate={onNavigate} onDownload={vi.fn()} onLoadDirectory={onLoadDirectory}
      isMutationBusy={(file) => file.path === '/src'} />)

    expect(screen.getByRole('button', { name: '展开 src' })).toBeDisabled()
    await userEvent.dblClick(screen.getByText('src'))
    expect(onLoadDirectory).not.toHaveBeenCalled()
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('drops expanded child caches when the catalog revision changes', async () => {
    const onLoadDirectory = vi.fn(async () => [{ name: 'old.go', path: '/src/old.go', size: 1, modified: '', isDir: false }])
    const props = { currentPath: '/', files: rootFiles, loading: false, showHiddenFiles: false, selected: null, onSelect: vi.fn(), onNavigate: vi.fn(), onDownload: vi.fn(), onLoadDirectory }
    const view = render(<FileTreeView {...props} catalogRevision={0} />)
    await userEvent.click(screen.getByRole('button', { name: '展开 src' }))
    expect(await screen.findByText('old.go')).toBeInTheDocument()

    view.rerender(<FileTreeView {...props} catalogRevision={1} />)

    expect(screen.queryByText('old.go')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '展开 src' })).toBeInTheDocument()
  })

  it('namespaces tree item IDs without exposing remote paths', () => {
    const unsafePath = '/dir with spaces/"quoted"'
    const files = [{ name: 'quoted', path: unsafePath, size: 1, modified: '', isDir: false }]
    const props = {
      currentPath: '/', files, loading: false, showHiddenFiles: true, selected: null,
      onSelect: vi.fn(), onNavigate: vi.fn(), onDownload: vi.fn(), onLoadDirectory: vi.fn(async () => []),
    }
    render(<><FileTreeView {...props} /><FileTreeView {...props} /></>)

    const trees = screen.getAllByRole('tree')
    const firstItem = within(trees[0]).getByRole('treeitem')
    const secondItem = within(trees[1]).getByRole('treeitem')
    expect(firstItem.id).not.toContain(unsafePath)
    expect(secondItem.id).not.toContain(unsafePath)
    expect(firstItem.id).not.toBe(secondItem.id)
    expect(trees[0]).toHaveAttribute('aria-activedescendant', firstItem.id)
    expect(trees[1]).toHaveAttribute('aria-activedescendant', secondItem.id)
  })
})
