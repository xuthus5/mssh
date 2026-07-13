import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SessionWorkspaceProvider, useSessionWorkspace } from '@/hooks/SessionWorkspaceContext'
import { useSession } from '@/hooks/useSession'

vi.mock('@/hooks/useSession', () => ({
  useSession: vi.fn(() => ({ marker: 'workspace-state' })),
}))

describe('SessionWorkspaceContext', () => {
  it('provides the useSession state to descendants', () => {
    render(
      <SessionWorkspaceProvider>
        <WorkspaceConsumer />
      </SessionWorkspaceProvider>,
    )

    expect(screen.getByText('workspace-state')).toBeInTheDocument()
    expect(useSession).toHaveBeenCalledTimes(1)
  })

  it('rejects consumers outside the provider', () => {
    expect(() => render(<WorkspaceConsumer />)).toThrow(
      'useSessionWorkspace must be used within SessionWorkspaceProvider',
    )
  })
})

function WorkspaceConsumer() {
  const state = useSessionWorkspace() as ReturnType<typeof useSession> & { marker: string }
  return <span>{state.marker}</span>
}
