import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

const state = {
  folders: [{ id: '1', name: '默认分组', parentId: null, isDefault: true }, { id: '2', name: '生产环境', parentId: null, isDefault: false }],
  sessions: [session('1', '生产服务器', '2'), session('2', '测试服务器', '1')],
  recentSessions: [{ ...session('1', '生产服务器', '2'), lastConnectedAt: '2026-07-12T12:00:00Z', connectionCount: 3 }],
  loading: false,
  error: '',
  listFolders: vi.fn(async () => {}), listSessions: vi.fn(async () => {}), listRecentSessions: vi.fn(async () => {}),
  connect: vi.fn(async () => {}), deleteFolder: vi.fn(async () => {}), deleteSession: vi.fn(async () => {}), setDefaultFolder: vi.fn(async () => {}),
  moveSession: vi.fn(async () => {}),
}

vi.mock('@/hooks/SessionWorkspaceContext', () => ({ useSessionWorkspace: () => state }))

import { SessionAssetCenter } from '@/components/session/SessionAssetCenter'

describe('SessionAssetCenter', () => {
  it('renders recent, folder, and node asset tabs', () => {
    render(<SessionAssetCenter />)
    expect(screen.getByRole('tab', { name: /最近连接/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /分组/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /所有节点/ })).toBeInTheDocument()
    expect(screen.getByText('生产服务器')).toBeInTheDocument()
  })

  it('opens a folder in the filtered node tab', async () => {
    render(<SessionAssetCenter />)
    await userEvent.click(screen.getByRole('tab', { name: /分组/ }))
    await userEvent.click(screen.getByRole('button', { name: '生产环境' }))
    expect(screen.getByRole('tab', { name: /所有节点/ })).toHaveAttribute('data-active')
    expect(screen.getByText('生产服务器')).toBeInTheDocument()
    expect(screen.queryByText('测试服务器')).not.toBeInTheDocument()
  })

  it('offers session and folder creation from one menu', async () => {
    render(<SessionAssetCenter />)
    await userEvent.click(screen.getByRole('button', { name: '创建' }))
    expect(await screen.findByText('新建会话')).toBeInTheDocument()
    expect(screen.getByText('新建分组目录')).toBeInTheDocument()
  })
})

function session(id: string, name: string, folderId: string) {
  return { id, name, host: '192.168.1.48', port: 22, username: 'root', authMethod: 'password' as const, keepAlive: 30, termType: 'xterm-256color', folderId, connectionCount: 0 }
}
