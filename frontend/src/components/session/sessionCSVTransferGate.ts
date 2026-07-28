import { useSyncExternalStore } from 'react'

export type SessionCSVTransferAction = 'import' | 'export'

interface SessionCSVTransferLease {
  release: () => void
}

let activeAction: SessionCSVTransferAction | null = null
let activeToken: symbol | null = null
const listeners = new Set<() => void>()

export function acquireSessionCSVTransfer(action: SessionCSVTransferAction): SessionCSVTransferLease | null {
  if (activeToken) return null
  const token = Symbol(action)
  activeToken = token
  activeAction = action
  notifyListeners()
  return {
    release: () => {
      if (activeToken !== token) return
      activeToken = null
      activeAction = null
      notifyListeners()
    },
  }
}

export function useSessionCSVTransferAction() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return activeAction
}

function notifyListeners() {
  for (const listener of listeners) listener()
}
