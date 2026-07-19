import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FileTreeView } from '@/components/file/FileTreeView'
import type { FileInfo } from '@/hooks/useFileTransfer'

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
})
