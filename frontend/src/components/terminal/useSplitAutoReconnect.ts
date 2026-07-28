import { useEffect, useRef } from 'react'
import { AutoReconnectScheduler } from '@/hooks/autoReconnectScheduler'
import {
  RECONNECT_SPLIT_PANE_EVENT,
  type ReconnectSplitPaneDetail,
} from '@/hooks/sessionReconnect'
import { useTerminalBehaviorStore } from '@/store/terminalBehaviorStore'
import { useConnectDialog } from '@/store/connectDialog'
import { useAppStore } from '@/store/appStore'
import { hasTerminal, type SplitNode } from '@/components/terminal/splitTree'
import { MAX_SPLIT_PANES } from '@/components/terminal/terminalSplitActions'
import { logger } from '@/lib/logger'

interface SplitReconnectCompletion {
  promise: Promise<void>
  resolve: () => void
  started: boolean
}

interface SplitAutoReconnectOptions {
  tabID: string
  busy: boolean
  treeRef: { current: SplitNode }
  operationRef: { current: boolean }
  mountedRef: { current: boolean }
  reconnectRef: { current: (terminalID: string) => Promise<void> }
}

export function useSplitAutoReconnect(options: SplitAutoReconnectOptions) {
  const completionsRef = useRef(new Map<string, SplitReconnectCompletion>())
  const optionsRef = useRef(options)
  optionsRef.current = options
  const schedulerRef = useRef<AutoReconnectScheduler | null>(null)
  if (!schedulerRef.current) {
    schedulerRef.current = new AutoReconnectScheduler({
      maxPending: MAX_SPLIT_PANES,
      isBlocked: () => optionsRef.current.operationRef.current || useConnectDialog.getState().open,
      onError: (error) => logger.error('split auto reconnect scheduler failed', error),
    })
  }

  useEffect(() => {
    if (!options.busy) schedulerRef.current?.wake()
  }, [options.busy])

  useEffect(() => {
    const scheduler = schedulerRef.current
    if (!scheduler) return
    const enqueue = (terminalID: string) => enqueueSplitReconnect(
      terminalID,
      scheduler,
      completionsRef.current,
      optionsRef,
    )
    const onReconnect = (event: Event) => {
      const detail = (event as CustomEvent<ReconnectSplitPaneDetail>).detail
      if (!detail || detail.tabID !== options.tabID) return
      if (!hasTerminal(options.treeRef.current, detail.terminalID)) return
      detail.accept(() => enqueue(detail.terminalID))
    }
    const unsubscribers = [
      useAppStore.subscribe(() => scheduler.prune()),
      useTerminalBehaviorStore.subscribe((state, previous) => {
        if (!state.autoReconnect) scheduler.clear()
        else if (!previous.autoReconnect) scheduler.wake()
      }),
      useConnectDialog.subscribe((state, previous) => {
        if (previous.open && !state.open) scheduler.wake()
      }),
    ]
    window.addEventListener(RECONNECT_SPLIT_PANE_EVENT, onReconnect)
    return () => {
      window.removeEventListener(RECONNECT_SPLIT_PANE_EVENT, onReconnect)
      for (const unsubscribe of unsubscribers) unsubscribe()
      scheduler.clear()
    }
  }, [options.tabID, options.treeRef])
}

function enqueueSplitReconnect(...args: [
  string,
  AutoReconnectScheduler,
  Map<string, SplitReconnectCompletion>,
  { current: SplitAutoReconnectOptions },
]) {
  const [terminalID, scheduler, completions, optionsRef] = args
  const existing = completions.get(terminalID)
  if (existing) return existing.promise
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => { resolve = resolvePromise })
  const completion = { promise, resolve, started: false }
  const tabID = optionsRef.current.tabID
  completions.set(terminalID, completion)
  const settle = () => {
    if (completions.get(terminalID) !== completion) return
    completions.delete(terminalID)
    completion.resolve()
  }
  const result = scheduler.enqueue({
    tabID,
    terminalID,
    canRun: () => optionsRef.current.tabID === tabID
      && canReconnectSplit(terminalID, optionsRef.current),
    run: async () => {
      completion.started = true
      try {
        await optionsRef.current.reconnectRef.current(terminalID)
      } finally {
        settle()
      }
    },
    cancel: () => {
      if (!completion.started) settle()
    },
  })
  if (result !== 'enqueued') settle()
  if (result === 'full') logger.warn('split auto reconnect queue full', { terminalID })
  return promise
}

function canReconnectSplit(terminalID: string, options: SplitAutoReconnectOptions) {
  return options.mountedRef.current
    && useTerminalBehaviorStore.getState().autoReconnect
    && hasTerminal(options.treeRef.current, terminalID)
    && useAppStore.getState().connectionStatus[terminalID] === 'disconnected'
}
