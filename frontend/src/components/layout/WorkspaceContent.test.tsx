import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/session/SessionAssetCenter', () => ({
  SessionAssetCenter: () => <div>会话资产工作区</div>,
}))

import { WorkspaceContent } from '@/components/layout/WorkspaceContent'
import { useAppStore } from '@/store/appStore'

describe('WorkspaceContent accessibility', () => {
  beforeEach(() => {
    useAppStore.setState({ activeSurface: { type: 'workspace', id: 'sessions' }, workspaceTab: 'sessions' })
  })

  it('labels the workspace panel from the selected fixed tab', () => {
    render(<WorkspaceContent />)

    const panel = screen.getByRole('region')
    expect(panel).toHaveAttribute('id', 'workspace-panel')
    expect(panel).toHaveAttribute('aria-labelledby', 'workspace-tab-sessions')
  })
})
