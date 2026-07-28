import { create } from 'zustand'
import { logger } from '@/lib/logger'

export interface HostKeyPrompt {
  attemptId: string
  hostname: string
  fingerprint: string
  algorithm: string
}

export interface HostKeyEndpoint {
  host: string
  port: number
}

export interface HostKeyPromptRequest {
  coordinatorId: number
  prompt: HostKeyPrompt
  endpoint: HostKeyEndpoint
  decide: (accept: boolean) => Promise<void>
  dismiss: () => Promise<void>
}

interface HostKeyPromptDialogState {
  active: HostKeyPromptRequest | null
  pending: boolean
  error: string
  present: (request: HostKeyPromptRequest) => boolean
  decide: (accept: boolean) => Promise<void>
  dismiss: () => Promise<void>
  clear: (coordinatorId: number) => void
}

const inactiveState = () => ({ active: null, pending: false, error: '' })

export const useHostKeyPromptDialog = create<HostKeyPromptDialogState>((set, get) => ({
  ...inactiveState(),
  present: (request) => {
    if (get().active) return false
    set({ active: request, pending: false, error: '' })
    return true
  },
  decide: async (accept) => {
    const current = get().active
    if (!current || get().pending) return
    set({ pending: true, error: '' })
    try {
      await current.decide(accept)
      if (get().active === current) set(inactiveState())
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (get().active === current) set({ pending: false, error: message })
    }
  },
  dismiss: async () => {
    const current = get().active
    if (!current || get().pending) return
    set({ pending: true, error: '' })
    try {
      await current.dismiss()
      if (get().active === current) set(inactiveState())
    } catch (error: unknown) {
      logger.error('dismiss host key prompt failed', error)
      const message = error instanceof Error ? error.message : String(error)
      if (get().active === current) set({ pending: false, error: message })
    }
  },
  clear: (coordinatorId) => {
    if (get().active?.coordinatorId === coordinatorId) set(inactiveState())
  },
}))
