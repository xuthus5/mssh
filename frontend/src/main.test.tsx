import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'

const render = vi.fn()
const startEventBridge = vi.fn()

vi.mock('react-dom/client', () => ({
  default: { createRoot: () => ({ render }) },
}))
vi.mock('@/store/eventBridge', () => ({ startEventBridge }))
vi.mock('./App', () => ({ default: () => <div>app</div> }))
vi.mock('@/components/settings/SettingsWindowApp', () => ({ SettingsWindowApp: () => <div>settings</div> }))

describe('application entry', () => {
  afterEach(() => {
    cleanup()
    vi.resetModules()
    render.mockClear()
    startEventBridge.mockClear()
    window.history.replaceState({}, '', '/')
  })

  it('mounts the application once without strict mode remounting', async () => {
    document.body.innerHTML = '<div id="root"></div>'

    await import('./main')

    await waitFor(() => expect(render).toHaveBeenCalledTimes(1))
    const element = render.mock.calls[0][0]
    expect(element.type.name).toBe('LanguageProvider')
    expect(element.props.children.type.name).toBe('TooltipProvider')
    expect(element.props.children.props.children.type.name).toBe('default')
    expect(startEventBridge).toHaveBeenCalledOnce()
  })

  it('mounts only the settings application for the settings window', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    window.history.replaceState({}, '', '/?window=settings')

    await import('./main')

    await waitFor(() => expect(render).toHaveBeenCalledTimes(1))
    const element = render.mock.calls[0][0]
    expect(element.type.name).toBe('LanguageProvider')
    expect(element.props.children.type.name).toBe('TooltipProvider')
    expect(element.props.children.props.children.type.name).toBe('SettingsWindowApp')
    expect(startEventBridge).not.toHaveBeenCalled()
  })
})
