import type { RefObject } from 'react'
import type { IDisposable, Terminal } from '@xterm/xterm'
import { useTerminalDirectoryStore } from '@/store/terminalDirectoryStore'

export function parseTerminalWorkingDirectory(payload: string): string | null {
  const value = payload.trim()
  if (!value) return null
  if (!value.startsWith('file://')) return normalizeRemotePath(value)
  try {
    const url = new URL(value)
    if (url.protocol !== 'file:') return null
    return normalizeRemotePath(decodeURIComponent(url.pathname))
  } catch {
    return null
  }
}

function normalizeRemotePath(path: string): string | null {
  if (!path.startsWith('/')) return null
  if (path.length === 1) return path
  return path.replace(/\/+$/, '')
}

export function subscribeToTerminalWorkingDirectory(term: Terminal, terminalIDRef: RefObject<string>): IDisposable {
  let trackedTerminalID = terminalIDRef.current
  const handler = term.parser.registerOscHandler(7, (payload) => {
    const path = parseTerminalWorkingDirectory(payload)
    if (!path) return false
    const terminalID = terminalIDRef.current
    if (trackedTerminalID !== terminalID) useTerminalDirectoryStore.getState().clearDirectory(trackedTerminalID)
    trackedTerminalID = terminalID
    useTerminalDirectoryStore.getState().setDirectory(terminalID, path)
    return true
  })
  return {
    dispose: () => {
      handler.dispose()
      useTerminalDirectoryStore.getState().clearDirectory(trackedTerminalID)
    },
  }
}
