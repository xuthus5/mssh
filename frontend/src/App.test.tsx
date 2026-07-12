import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/session/SessionAssetCenter', () => ({ SessionAssetCenter: () => <div>会话资产工作区</div> }))

import { EmptyWorkspace } from '@/App'

describe('EmptyWorkspace', () => {
  it('shows welcome only before the first workspace entry', () => {
    const view = render(<EmptyWorkspace entered={false} workspace="sessions" />)
    expect(screen.getByText('Secure Shell Client & Session Manager')).toBeInTheDocument()
    view.rerender(<EmptyWorkspace entered workspace="sessions" />)
    expect(screen.queryByText('Secure Shell Client & Session Manager')).not.toBeInTheDocument()
    expect(screen.getByText('会话资产工作区')).toBeInTheDocument()
  })

  it('does not restore welcome when macros are selected', () => {
    render(<EmptyWorkspace entered workspace="macros" />)
    expect(screen.queryByText('Secure Shell Client & Session Manager')).not.toBeInTheDocument()
    expect(screen.getByLabelText('宏工作区')).toBeInTheDocument()
  })
})
