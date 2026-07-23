import { create } from 'zustand'
import { SessionService } from '@/lib/wails'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'


export type ConnectState = 'idle' | 'connecting' | 'awaiting-host-key' | 'connected' | 'failed' | 'cancelling'

interface ConnectDialogState {
  open: boolean
  state: ConnectState
  host: string
  port: number
  user: string
  error: string
  fingerprint: string
  algorithm: string
  attemptId: string
  sessionId: string
  retry: (() => void) | null
  openDialog: (host: string, port: number, user: string, retry: () => void, sessionId?: string) => void
  setState: (s: ConnectState) => void
  setError: (msg: string) => void
  setAttempt: (attemptId: string) => void
  setFingerprint: (attemptId: string, fp: string, algorithm: string) => void
  acceptHostKey: () => Promise<void>
  rejectHostKey: () => Promise<void>
  cancelConnection: () => Promise<void>
  closeDialog: () => void
  /** Close dialog if it is tracking one of the given sessions (e.g. session deleted). */
  dismissForSessions: (sessionIDs: Iterable<string>) => void
}

export const useConnectDialog = create<ConnectDialogState>((set) => ({
  open: false,
  state: 'idle',
  host: '',
  port: 0,
  user: '',
  error: '',
  fingerprint: '',
  algorithm: '',
  attemptId: '',
  sessionId: '',
  retry: null,
  openDialog: (host, port, user, retry, sessionId = '') => set({
    open: true,
    state: 'connecting',
    host,
    port,
    user,
    retry,
    sessionId: sessionId ? String(sessionId) : '',
    error: '',
    fingerprint: '',
    algorithm: '',
    attemptId: '',
  }),
  setState: (s) => {
    if (s === 'connected') set({ open: false, state: 'idle' })
    else set({ state: s })
  },
  setError: (msg) => set({ state: 'failed', error: msg }),
  setAttempt: (attemptId) => set({ attemptId }),
  setFingerprint: (attemptId, fingerprint, algorithm) => set({ attemptId, fingerprint, algorithm, state: 'awaiting-host-key' }),
  acceptHostKey: async () => {
    const { attemptId } = useConnectDialog.getState()
    if (!attemptId) {
      const message = t('连接尝试尚未就绪')
      set({ state: 'failed', error: message })
      toast(t('主机密钥确认失败: ${}', message), 'error')
      throw new Error(message)
    }
    try {
      await SessionService.DecideHostKey(attemptId, true)
      set({ state: 'connecting', fingerprint: '', algorithm: '' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ state: 'failed', error: message })
      toast(t('主机密钥确认失败: ${}', message), 'error')
      throw error
    }
  },
  rejectHostKey: async () => {
    const { attemptId } = useConnectDialog.getState()
    try {
      if (attemptId) await SessionService.DecideHostKey(attemptId, false)
      set({ open: false, state: 'idle', fingerprint: '', algorithm: '', attemptId: '', sessionId: '', error: '' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ state: 'failed', error: message })
      toast(t('拒绝主机密钥失败: ${}', message), 'error')
      throw error
    }
  },
  cancelConnection: async () => {
    const { attemptId } = useConnectDialog.getState()
    set({ state: 'cancelling' })
    try {
      if (attemptId) await SessionService.CancelConnect(attemptId)
      set({ open: false, state: 'idle', attemptId: '', sessionId: '', fingerprint: '', algorithm: '', error: '' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ state: 'failed', error: message })
      toast(t('取消连接失败: ${}', message), 'error')
      throw error
    }
  },
  closeDialog: () => set({ open: false, state: 'idle', attemptId: '', sessionId: '', fingerprint: '', algorithm: '', retry: null }),
  dismissForSessions: (sessionIDs) => {
    const targets = new Set([...sessionIDs].map(String).filter(Boolean))
    if (targets.size === 0) return
    const current = useConnectDialog.getState()
    if (!current.open || !current.sessionId || !targets.has(String(current.sessionId))) return
    useConnectDialog.getState().closeDialog()
  },
}))
