import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/file/TransferCenter', () => ({ TransferCenter: () => <div>transfer center</div> }))

import StatusBar from '@/components/layout/StatusBar'
import { useAppStore } from '@/store/appStore'

describe('StatusBar', () => {
  beforeEach(() => {
    useAppStore.setState({ tabs: [], activeSurface: null, connectionStatus: {}, appStatus: '就绪' })
  })

  it('shows the active terminal status without the tunnel action', () => {
    useAppStore.setState({
      tabs: [{ id: 'tab-1', title: 'production', type: 'terminal', terminalId: 'term-1', sessionId: 1 }],
      activeSurface: { type: 'terminal', id: 'tab-1' },
      connectionStatus: { 'term-1': 'connected' },
    })

    render(<StatusBar />)

    expect(screen.getByText('已连接')).toBeInTheDocument()
    expect(screen.getByText('production')).toBeInTheDocument()
    expect(screen.queryByTitle('隧道管理')).not.toBeInTheDocument()
  })

  it('shows application status for a non-terminal surface', () => {
    useAppStore.setState({
      tabs: [{ id: 'playback-1', title: 'replay', type: 'playback', recordingPath: '/tmp/replay.log' }],
      activeSurface: { type: 'playback', id: 'playback-1' },
      appStatus: '应用就绪',
    })

    render(<StatusBar />)

    expect(screen.getByText('应用就绪')).toBeInTheDocument()
    expect(screen.getByText('replay')).toBeInTheDocument()
  })
})
