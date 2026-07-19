import type { RefObject } from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { parseTerminalWorkingDirectory, subscribeToTerminalWorkingDirectory } from '@/hooks/terminalDirectoryRuntime'
import { useTerminalDirectoryStore } from '@/store/terminalDirectoryStore'

describe('terminalDirectoryRuntime', () => {
  beforeEach(() => useTerminalDirectoryStore.setState({ directories: {} }))

  it('parses OSC 7 file URLs and URL encoded paths', () => {
    expect(parseTerminalWorkingDirectory('file://server/home/user')).toBe('/home/user')
    expect(parseTerminalWorkingDirectory('file://server/home/user%20name')).toBe('/home/user name')
  })

  it('parses absolute paths and rejects unsupported values', () => {
    expect(parseTerminalWorkingDirectory('/var/www/')).toBe('/var/www')
    expect(parseTerminalWorkingDirectory('/')).toBe('/')
    expect(parseTerminalWorkingDirectory('relative/path')).toBeNull()
    expect(parseTerminalWorkingDirectory('')).toBeNull()
    expect(parseTerminalWorkingDirectory('file://%invalid')).toBeNull()
  })

  it('stores the latest OSC 7 directory and clears it on dispose', () => {
    let oscHandler!: (payload: string) => boolean
    const handlerDispose = vi.fn()
    const term = { parser: { registerOscHandler: vi.fn((_code: number, handler: (payload: string) => boolean) => { oscHandler = handler; return { dispose: handlerDispose } }) } }
    const terminalIDRef = { current: 'term-1' } as RefObject<string>

    const subscription = subscribeToTerminalWorkingDirectory(term as never, terminalIDRef)
    expect(oscHandler('file://host/home/dev')).toBe(true)
    expect(useTerminalDirectoryStore.getState().directories['term-1']).toBe('/home/dev')
    expect(oscHandler('not-a-path')).toBe(false)
    terminalIDRef.current = 'term-2'
    expect(oscHandler('/srv/app')).toBe(true)
    expect(useTerminalDirectoryStore.getState().directories['term-1']).toBeUndefined()
    expect(useTerminalDirectoryStore.getState().directories['term-2']).toBe('/srv/app')

    subscription.dispose()
    expect(handlerDispose).toHaveBeenCalledOnce()
    expect(useTerminalDirectoryStore.getState().directories['term-2']).toBeUndefined()
  })
})
