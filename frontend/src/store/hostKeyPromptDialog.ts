import { create, type StateCreator } from 'zustand'
import { logger } from '@/lib/logger'

export interface HostKeyPrompt {
  attemptId: string
  requestId?: string
  isJumpHost?: boolean
  usesJumpHost?: boolean
  hostname: string
  fingerprint: string
  algorithm: string
  changed: boolean
  expected: string[]
  /**
   * 触发指纹确认的终端页签。为空表示全局弹框（例如新建连接）；
   * 其它页签的确认弹框会在切换到该页签时才展示。
   */
  targetTabId?: string | null
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
  deferred: HostKeyPromptRequest[]
  activeTabId: string | null
  pending: boolean
  error: string
  present: (request: HostKeyPromptRequest) => boolean
  hasAttempt: (attemptId: string) => boolean
  setActiveTabId: (tabId: string | null) => void
  pruneTabs: (tabIds: Iterable<string>) => void
  decide: (accept: boolean) => Promise<void>
  dismiss: () => Promise<void>
  clear: (coordinatorId: number) => void
  finishAttempt: (attemptId: string, coordinatorId: number) => void
}

type PromptSet = Parameters<StateCreator<HostKeyPromptDialogState>>[0]
type PromptGet = Parameters<StateCreator<HostKeyPromptDialogState>>[1]

const inactiveState = () => ({ active: null, pending: false, error: '' })

function isVisible(request: HostKeyPromptRequest, activeTabId: string | null) {
  const target = request.prompt.targetTabId
  return !target || target === activeTabId
}

function promoteNext(set: PromptSet, get: PromptGet) {
  const state = get()
  if (state.active) return
  const index = state.deferred.findIndex((request) => isVisible(request, state.activeTabId))
  if (index < 0) return
  set({
    active: state.deferred[index],
    deferred: state.deferred.filter((_, position) => position !== index),
    pending: false,
    error: '',
  })
}

function createPresentationActions(set: PromptSet, get: PromptGet) {
  return {
    present: (request: HostKeyPromptRequest) => {
      const state = get()
      if (state.active?.prompt.attemptId === request.prompt.attemptId) return false
      if (state.deferred.some((item) => item.prompt.attemptId === request.prompt.attemptId)) return false
      if (!state.active && isVisible(request, state.activeTabId)) {
        set({ active: request, pending: false, error: '' })
        return true
      }
      set({ deferred: [...state.deferred, request] })
      return true
    },
    hasAttempt: (attemptId: string) => {
      const state = get()
      return state.active?.prompt.attemptId === attemptId
        || state.deferred.some((item) => item.prompt.attemptId === attemptId)
    },
    setActiveTabId: (tabId: string | null) => {
      if (get().activeTabId === tabId) return
      set({ activeTabId: tabId })
      const state = get()
      if (state.active && !isVisible(state.active, tabId)) {
        set({ active: null, deferred: [state.active, ...state.deferred] })
      }
      promoteNext(set, get)
    },
    pruneTabs: (tabIds: Iterable<string>) => {
      const allowed = new Set(tabIds)
      const state = get()
      const deferred = state.deferred.filter((item) => !item.prompt.targetTabId || allowed.has(item.prompt.targetTabId))
      if (deferred.length === state.deferred.length) return
      set({ deferred })
    },
  }
}

function createSettlementActions(set: PromptSet, get: PromptGet) {
  return {
    decide: async (accept: boolean) => {
      const current = get().active
      if (!current || get().pending) return
      set({ pending: true, error: '' })
      try {
        await current.decide(accept)
        if (get().active === current) { set(inactiveState()); promoteNext(set, get) }
      } catch (error: unknown) {
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
        if (get().active === current) { set(inactiveState()); promoteNext(set, get) }
      } catch (error: unknown) {
        logger.error('dismiss host key prompt failed', error)
        const message = error instanceof Error ? error.message : String(error)
        if (get().active === current) set({ pending: false, error: message })
      }
    },
    clear: (coordinatorId: number) => {
      const state = get()
      const active = state.active?.coordinatorId === coordinatorId ? null : state.active
      const deferred = state.deferred.filter((item) => item.coordinatorId !== coordinatorId)
      set({ active, deferred })
      promoteNext(set, get)
    },
    finishAttempt: (attemptId: string, coordinatorId: number) => {
      const state = get()
      const owned = (item: HostKeyPromptRequest) => item.coordinatorId === coordinatorId && item.prompt.attemptId === attemptId
      const active = state.active && owned(state.active) ? null : state.active
      const deferred = state.deferred.filter((item) => !owned(item))
      if (active === state.active && deferred.length === state.deferred.length) return
      set({ active, deferred })
      promoteNext(set, get)
    },
  }
}

export const useHostKeyPromptDialog = create<HostKeyPromptDialogState>((set, get) => ({
  ...inactiveState(),
  deferred: [],
  activeTabId: null,
  ...createPresentationActions(set, get),
  ...createSettlementActions(set, get),
}))
