import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/session/SessionAssetCenter', () => ({ SessionAssetCenter: () => <div>会话资产页面</div> }))
vi.mock('@/components/settings/KeyManager', () => ({ KeyManager: () => <div>密钥管理页面</div> }))
vi.mock('@/components/session/TunnelDialog', () => ({ default: () => <div>隧道管理弹框</div> }))
vi.mock('@/components/layout/AuditPanel', () => ({ AuditPanel: () => <div>审计日志页面</div> }))
vi.mock('@/components/serial/SerialPortCenter', () => ({ SerialPortCenter: () => <div>串口管理页面</div> }))
vi.mock('@/hooks/useSettings', () => ({
  useKeySettings: () => ({
    keys: [], generateKey: vi.fn(), importKey: vi.fn(), deleteKey: vi.fn(), exportKey: vi.fn(),
    loadKeyMaterial: vi.fn(), updateKey: vi.fn(), selectKeyImportFile: vi.fn(),
  }),
}))
vi.mock('@/hooks/useTunnelManager', () => ({
  useTunnelManager: () => ({ tunnels: [], error: '', loading: false, load: vi.fn(async () => {}), start: vi.fn(), stop: vi.fn(), remove: vi.fn() }),
}))
vi.mock('@/hooks/SessionWorkspaceContext', () => ({
  useSessionWorkspace: () => ({ sessions: [{ id: '1', name: 'Production' }] }),
}))

import { OverviewContent } from '@/components/layout/OverviewContent'
import { useAppStore } from '@/store/appStore'

describe('OverviewContent', () => {
  beforeEach(() => useAppStore.setState({ overviewSection: 'sessions' }))

  it('renders the session asset center by default', () => {
    render(<OverviewContent />)
    expect(screen.getByText('会话资产页面')).toBeInTheDocument()
  })

  it('renders key management as an overview page', () => {
    useAppStore.setState({ overviewSection: 'keys' })
    render(<OverviewContent />)
    expect(screen.getByRole('heading', { name: '密钥配置' })).toBeInTheDocument()
    expect(screen.getByText('密钥管理页面')).toBeInTheDocument()
  })

  it('renders tunnel management for the selected session', () => {
    useAppStore.setState({ overviewSection: 'tunnels' })
    render(<OverviewContent />)
    expect(screen.getByRole('heading', { name: '隧道配置' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '隧道所属会话' })).toHaveTextContent('Production')
    expect(screen.getByText('当前会话暂无隧道')).toBeInTheDocument()
  })

  it('renders enterprise audit records', () => {
    useAppStore.setState({ overviewSection: 'audit' })
    render(<OverviewContent />)
    expect(screen.getByText('审计日志页面')).toBeInTheDocument()
  })

  it('renders serial management as an overview page', () => {
    useAppStore.setState({ overviewSection: 'serial' })
    render(<OverviewContent />)
    expect(screen.getByText('串口管理页面')).toBeInTheDocument()
  })
})
