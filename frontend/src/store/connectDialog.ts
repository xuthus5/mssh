import { create, type StateCreator } from 'zustand'
import { logger } from '@/lib/logger'

export type ConnectState = 'idle' | 'connecting' | 'connected' | 'failed' | 'cancelling'

interface ConnectDialogState {
  open: boolean
  state: ConnectState
  host: string
  port: number
  user: string
  error: string
  sessionId: string
  dialogId: number
  cancelRequest: (() => void) | null
  retry: (() => void) | null
  openDialog: (host: string, port: number, user: string, retry: () => void, sessionId?: string) => number
  setCancelHandler: (dialogId: number, cancelRequest: () => void) => void
  completeDialog: (dialogId: number) => void
  failDialog: (dialogId: number, message: string) => void
  cancelConnection: () => Promise<void>
  closeDialog: (dialogId?: number) => void
  dismissForSessions: (sessionIDs: Iterable<string>) => void
}

let nextDialogId = 1

const idleDialog = () => ({
  open: false,
  state: 'idle' as ConnectState,
  host: '',
  port: 0,
  user: '',
  error: '',
  sessionId: '',
  dialogId: 0,
  cancelRequest: null,
  retry: null,
})

type DialogSet = Parameters<StateCreator<ConnectDialogState>>[0]
type DialogGet = Parameters<StateCreator<ConnectDialogState>>[1]

function createDialogLifecycleActions(set: DialogSet, get: DialogGet) {
  return {
  openDialog: (...args: Parameters<ConnectDialogState['openDialog']>) => {
    const [host, port, user, retry, sessionId = ''] = args
    const dialogId = nextDialogId++
    set({
      open: true,
      state: 'connecting',
      host,
      port,
      user,
      retry,
      sessionId: sessionId ? String(sessionId) : '',
      error: '',
      dialogId,
      cancelRequest: null,
    })
    return dialogId
  },
  setCancelHandler: (dialogId: number, cancelRequest: () => void) => {
    if (get().dialogId === dialogId) set({ cancelRequest })
  },
  completeDialog: (dialogId: number) => {
    if (get().dialogId === dialogId) set(idleDialog())
  },
  failDialog: (dialogId: number, message: string) => {
    if (get().dialogId === dialogId) set({ state: 'failed', error: message })
  },
  }
}

function createDialogCloseActions(set: DialogSet, get: DialogGet) {
  return {
  cancelConnection: async () => {
    const current = get()
    if (!current.open) return
    set({ state: 'cancelling' })
    try {
      current.cancelRequest?.()
      if (get().dialogId === current.dialogId) set(idleDialog())
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (get().dialogId === current.dialogId) set({ state: 'failed', error: message })
      throw error
    }
  },
  closeDialog: (dialogId?: number) => {
    const current = get()
    if (dialogId && current.dialogId !== dialogId) return
    try {
      current.cancelRequest?.()
    } catch (error: unknown) {
      logger.error('cancel dialog request failed', error)
    }
    set(idleDialog())
  },
  dismissForSessions: (sessionIDs: Iterable<string>) => {
    const targets = new Set([...sessionIDs].map(String).filter(Boolean))
    if (targets.size === 0) return
    const current = get()
    if (!current.open || !current.sessionId || !targets.has(String(current.sessionId))) return
    get().closeDialog(current.dialogId)
  },
  }
}

export const useConnectDialog = create<ConnectDialogState>((set, get) => ({
  ...idleDialog(),
  ...createDialogLifecycleActions(set, get),
  ...createDialogCloseActions(set, get),
}))
