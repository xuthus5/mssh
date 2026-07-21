import type { RefObject } from 'react'
import type { IDisposable, Terminal } from '@xterm/xterm'
import { useTerminalDirectoryStore } from '@/store/terminalDirectoryStore'
import { t } from '@/i18n'


export const MANUAL_TERMINAL_DIRECTORY_REPORT = "printf '\\033]7;file://%s%s\\007' \"$HOSTNAME\" \"$PWD\"\r"
export const TERMINAL_DIRECTORY_REPORT_TIMEOUT_MS = 3000

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

export function waitForTerminalWorkingDirectory(terminalID: string, previousRevision: number, timeoutMs = TERMINAL_DIRECTORY_REPORT_TIMEOUT_MS): Promise<string> {
  const current = useTerminalDirectoryStore.getState()
  const currentRevision = current.revisions[terminalID] ?? 0
  if (currentRevision > previousRevision && current.directories[terminalID]) return Promise.resolve(current.directories[terminalID])
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {}
    const timeout = window.setTimeout(() => {
      unsubscribe()
      reject(new Error(t('终端未返回 OSC 7 工作目录信息')))
    }, timeoutMs)
    unsubscribe = useTerminalDirectoryStore.subscribe((state) => {
      const revision = state.revisions[terminalID] ?? 0
      const path = state.directories[terminalID]
      if (revision <= previousRevision || !path) return
      window.clearTimeout(timeout)
      unsubscribe()
      resolve(path)
    })
  })
}
