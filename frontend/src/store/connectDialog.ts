import { create } from 'zustand'
import { SessionService } from '@/lib/wails'
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
  retry: (() => void) | null
  openDialog: (host: string, port: number, user: string, retry: () => void) => void
  setState: (s: ConnectState) => void
  setError: (msg: string) => void
  setAttempt: (attemptId: string) => void
  setFingerprint: (attemptId: string, fp: string, algorithm: string) => void
  acceptHostKey: () => Promise<void>
  rejectHostKey: () => Promise<void>
  cancelConnection: () => Promise<void>
  closeDialog: () => void
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
  retry: null,
  openDialog: (host, port, user, retry) => set({ open: true, state: 'connecting', host, port, user, retry, error: '', fingerprint: '', algorithm: '', attemptId: '' }),
  setState: (s) => {
    if (s === 'connected') set({ open: false, state: 'idle' })
    else set({ state: s })
  },
  setError: (msg) => set({ state: 'failed', error: msg }),
  setAttempt: (attemptId) => set({ attemptId }),
  setFingerprint: (attemptId, fingerprint, algorithm) => set({ attemptId, fingerprint, algorithm, state: 'awaiting-host-key' }),
  acceptHostKey: async () => {
    const { attemptId } = useConnectDialog.getState()
    if (!attemptId) throw new Error(t('连接尝试尚未就绪'))
    await SessionService.DecideHostKey(attemptId, true)
    set({ state: 'connecting', fingerprint: '', algorithm: '' })
  },
  rejectHostKey: async () => {
    const { attemptId } = useConnectDialog.getState()
    if (attemptId) await SessionService.DecideHostKey(attemptId, false)
    set({ open: false, state: 'idle', fingerprint: '', algorithm: '', attemptId: '' })
  },
  cancelConnection: async () => {
    const { attemptId } = useConnectDialog.getState()
    set({ state: 'cancelling' })
    if (attemptId) await SessionService.CancelConnect(attemptId)
    set({ open: false, state: 'idle', attemptId: '', fingerprint: '', algorithm: '' })
  },
  closeDialog: () => set({ open: false, state: 'idle', attemptId: '', fingerprint: '', algorithm: '', retry: null }),
}))
