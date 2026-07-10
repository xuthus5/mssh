import { create } from 'zustand'

export type ConnectState = 'idle' | 'connecting' | 'connected' | 'failed'

interface ConnectDialogState {
  open: boolean
  state: ConnectState
  host: string
  port: number
  user: string
  error: string
  fingerprint: string
  openDialog: (host: string, port: number, user: string) => void
  setState: (s: ConnectState) => void
  setError: (msg: string) => void
  setFingerprint: (fp: string) => void
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
  openDialog: (host, port, user) => set({ open: true, state: 'connecting', host, port, user, error: '', fingerprint: '' }),
  setState: (s) => {
    set({ state: s })
    if (s === 'connected') {
      setTimeout(() => { set({ open: false, state: 'idle' }) }, 500)
    }
  },
  setError: (msg) => set({ state: 'failed', error: msg }),
  setFingerprint: (fp) => set({ fingerprint: fp }),
  closeDialog: () => set({ open: false, state: 'idle' }),
}))
