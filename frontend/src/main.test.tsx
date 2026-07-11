import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'

const render = vi.fn()

vi.mock('react-dom/client', () => ({
  default: { createRoot: () => ({ render }) },
}))
vi.mock('@/store/eventBridge', () => ({ startEventBridge: vi.fn() }))
vi.mock('./App', () => ({ default: () => <div>app</div> }))

describe('application entry', () => {
  afterEach(() => {
    cleanup()
    vi.resetModules()
    render.mockClear()
  })

  it('mounts the application once without strict mode remounting', async () => {
    document.body.innerHTML = '<div id="root"></div>'

    await import('./main')

    await waitFor(() => expect(render).toHaveBeenCalledTimes(1))
    const element = render.mock.calls[0][0]
    expect(element.type.name).toBe('TooltipProvider')
    expect(element.props.children.type.name).toBe('default')
  })
})
