import { create, type StateCreator } from 'zustand'
import { logger } from '@/lib/logger'
import type { SSHJumpHost } from '@/lib/sessionModels'
import { isRetiredConnectionRequest, retireConnectionRequest } from '@/store/connectionRequestRegistry'

export type ConnectState = 'idle' | 'connecting' | 'connected' | 'failed' | 'cancelling'
export type ConnectStage = 'jump' | 'target'
interface ConnectProgressUpdate { requestId: string; attemptId: string; stage: ConnectStage }

interface ConnectDialogState {
  open: boolean
  state: ConnectState
  host: string
  port: number
  user: string
  error: string
  sessionId: string
  dialogId: number
  requestId: string
  attemptId: string
  stage: ConnectStage
  jumpHost: Pick<SSHJumpHost, 'host' | 'port' | 'username'> | null
  cancelRequest: (() => void) | null
  retry: (() => void) | null
  openDialog: (host: string, port: number, user: string, retry: () => void, sessionId?: string) => number
  beginConnectionAttempt: (dialogId: number, jumpHost: SSHJumpHost) => string
  reportProgress: (progress: ConnectProgressUpdate) => void
  isRetiredRequest: (requestId?: string) => boolean
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
  requestId: '', attemptId: '', stage: 'target' as ConnectStage, jumpHost: null,
  cancelRequest: null,
  retry: null,
})

type DialogSet = Parameters<StateCreator<ConnectDialogState>>[0]
type DialogGet = Parameters<StateCreator<ConnectDialogState>>[1]

function createDialogLifecycleActions(set: DialogSet, get: DialogGet) {
  return {
  openDialog: (...args: Parameters<ConnectDialogState['openDialog']>) => {
    const [host, port, user, retry, sessionId = ''] = args
    retireDialogRequest(get())
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
      requestId: '', attemptId: '', stage: 'target', jumpHost: null,
      cancelRequest: null,
    })
    return dialogId
  },
  setCancelHandler: (dialogId: number, cancelRequest: () => void) => {
    if (get().dialogId === dialogId) set({ cancelRequest })
  },
  completeDialog: (dialogId: number) => {
    if (get().dialogId === dialogId) set({ state: 'connected', error: '', cancelRequest: null })
  },
  failDialog: (dialogId: number, message: string) => {
    if (get().dialogId === dialogId) set({ state: 'failed', error: message })
  },
  }
}

function createDialogProgressActions(set: DialogSet, get: DialogGet) {
  return {
    beginConnectionAttempt: (dialogId: number, jumpHost: SSHJumpHost) => {
      const requestId = crypto.randomUUID()
      const current = get()
      if (current.open && current.dialogId === dialogId) {
        retireConnectionRequest(current.requestId)
        set({ requestId, attemptId: '', stage: 'jump', state: 'connecting', error: '',
          jumpHost: { host: jumpHost.host, port: jumpHost.port, username: jumpHost.username } })
      }
      return requestId
    },
    reportProgress: (progress: ConnectProgressUpdate) => {
      const current = get()
      if (!ownsProgress(current, progress)) return
      if (current.stage === 'target' && progress.stage === 'jump') return
      set({ stage: progress.stage, attemptId: progress.attemptId })
    },
    isRetiredRequest: isRetiredConnectionRequest,
  }
}

function ownsProgress(dialog: ConnectDialogState, progress: ConnectProgressUpdate) {
  return dialog.open && dialog.state === 'connecting' && Boolean(dialog.jumpHost)
    && Boolean(progress.requestId && progress.attemptId) && dialog.requestId === progress.requestId
}

function retireDialogRequest(dialog: ConnectDialogState) {
  if (dialog.state !== 'connected') retireConnectionRequest(dialog.requestId)
}

function createDialogCloseActions(set: DialogSet, get: DialogGet) {
  return {
  cancelConnection: async () => {
    const current = get()
    if (!current.open) return
    retireDialogRequest(current)
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
    retireDialogRequest(current)
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
  ...createDialogProgressActions(set, get),
  ...createDialogCloseActions(set, get),
}))
