import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { Browser } from '@wailsio/runtime'
import type { GistOAuthResult, GistOAuthStart } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { logger } from '@/lib/logger'
import { t } from '@/i18n'

export type GistOAuthPhase = 'idle' | 'starting' | 'waiting' | 'success' | 'error'

interface GistOAuthCallbacks {
  start: () => Promise<GistOAuthStart>
  poll: (flowID: string) => Promise<GistOAuthResult>
  cancel: (flowID: string) => Promise<void>
  onConnected: (result: GistOAuthResult) => void | Promise<void>
}

export interface GistOAuthState {
  phase: GistOAuthPhase
  flow: GistOAuthStart | null
  result: GistOAuthResult | null
  error: string
  notice: string
  start: () => Promise<void>
  cancel: () => Promise<void>
}

interface GistOAuthRuntime {
  callbacks: RefObject<GistOAuthCallbacks>
  lifecycle: RefObject<number>
  flowID: RefObject<string | null>
  polling: RefObject<boolean>
  starting: RefObject<boolean>
}

interface GistOAuthViewState {
  phase: GistOAuthPhase
  flow: GistOAuthStart | null
  result: GistOAuthResult | null
  error: string
  notice: string
  retryAt: number
  setPhase: Dispatch<SetStateAction<GistOAuthPhase>>
  setFlow: Dispatch<SetStateAction<GistOAuthStart | null>>
  setResult: Dispatch<SetStateAction<GistOAuthResult | null>>
  setError: Dispatch<SetStateAction<string>>
  setNotice: Dispatch<SetStateAction<string>>
  setRetryAt: Dispatch<SetStateAction<number>>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function useGistOAuthRuntime(callbacks: GistOAuthCallbacks): GistOAuthRuntime {
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks
  const lifecycle = useRef(0)
  const flowID = useRef<string | null>(null)
  const polling = useRef(false)
  const starting = useRef(false)
  return { callbacks: callbacksRef, lifecycle, flowID, polling, starting }
}

function useGistOAuthView(): GistOAuthViewState {
  const [phase, setPhase] = useState<GistOAuthPhase>('idle')
  const [flow, setFlow] = useState<GistOAuthStart | null>(null)
  const [result, setResult] = useState<GistOAuthResult | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [retryAt, setRetryAt] = useState(0)
  return { phase, flow, result, error, notice, retryAt, setPhase, setFlow, setResult, setError, setNotice, setRetryAt }
}

function useGistOAuthUnmount({ callbacks, lifecycle, flowID }: GistOAuthRuntime) {
  useEffect(() => {
    const token = lifecycle.current
    return () => {
      if (lifecycle.current === token) lifecycle.current++
      const id = flowID.current
      flowID.current = null
      if (id) void callbacks.current.cancel(id).catch((cancelError: unknown) => logger.warn('cancel gist oauth on unmount failed', cancelError))
    }
  }, [callbacks, flowID, lifecycle])
}

function useGistOAuthPoll(runtime: GistOAuthRuntime, view: GistOAuthViewState) {
  const { callbacks, lifecycle, flowID, polling } = runtime
  const { setPhase, setFlow, setResult, setError, setNotice, setRetryAt } = view
  return useCallback(async (id: string) => {
    if (polling.current) return
    polling.current = true
    const token = lifecycle.current
    try {
      const next = await callbacks.current.poll(id)
      if (lifecycle.current !== token || flowID.current !== id) return
      if (next.status === 'pending') {
        setNotice(next.message || t('等待 GitHub 授权'))
        setRetryAt(Date.now() + Math.max(1, next.retry_after_seconds) * 1000)
        return
      }
      flowID.current = null
      setFlow(null)
      if (next.status === 'success') {
        setPhase('success')
        setResult(next)
        setNotice(next.message)
        try { await callbacks.current.onConnected(next) }
        catch (connectError) { logger.error('refresh sync after gist oauth failed', connectError) }
        return
      }
      setPhase('error')
      setError(next.message || t('GitHub 授权失败'))
    } catch (pollError) {
      if (lifecycle.current !== token) return
      flowID.current = null
      setFlow(null)
      setPhase('error')
      setError(errorMessage(pollError))
    } finally {
      polling.current = false
    }
  }, [callbacks, flowID, lifecycle, polling, setError, setFlow, setNotice, setPhase, setResult, setRetryAt])
}

function useGistOAuthTimer(view: GistOAuthViewState, pollOnce: (flowID: string) => Promise<void>) {
  const { flow, phase, retryAt } = view
  useEffect(() => {
    if (!flow || phase !== 'waiting') return
    const timer = window.setTimeout(() => { void pollOnce(flow.flow_id) }, Math.max(0, retryAt - Date.now()))
    return () => { window.clearTimeout(timer) }
  }, [flow, phase, pollOnce, retryAt])
}

function useGistOAuthStart(runtime: GistOAuthRuntime, view: GistOAuthViewState) {
  const { callbacks, lifecycle, flowID, starting } = runtime
  const { phase, setPhase, setFlow, setResult, setError, setNotice, setRetryAt } = view
  return useCallback(async () => {
    if (starting.current || phase === 'starting' || phase === 'waiting') return
    starting.current = true
    const token = lifecycle.current
    setPhase('starting')
    setError('')
    setNotice('')
    setResult(null)
    try {
      const next = await callbacks.current.start()
      if (lifecycle.current !== token) {
        if (next.flow_id) void callbacks.current.cancel(next.flow_id).catch((cancelError: unknown) => logger.warn('cancel stale gist oauth start failed', cancelError))
        return
      }
      flowID.current = next.flow_id
      setFlow(next)
      setPhase('waiting')
      setRetryAt(Date.now() + Math.max(1, next.interval_seconds) * 1000)
      try { await Browser.OpenURL(next.verification_uri) }
      catch (openError) {
        logger.warn('open GitHub device verification failed', openError)
        setNotice(t('无法自动打开浏览器，请手动访问授权页面。'))
      }
    } catch (startError) {
      if (lifecycle.current !== token) return
      setPhase('error')
      setError(errorMessage(startError))
    } finally {
      starting.current = false
    }
  }, [callbacks, flowID, lifecycle, phase, setError, setFlow, setNotice, setPhase, setResult, setRetryAt, starting])
}

function useGistOAuthCancel(runtime: GistOAuthRuntime, view: GistOAuthViewState) {
  const { callbacks, lifecycle, flowID } = runtime
  const { setPhase, setFlow, setError, setNotice } = view
  return useCallback(async () => {
    const id = flowID.current
    lifecycle.current++
    flowID.current = null
    setFlow(null)
    setPhase('idle')
    setError('')
    setNotice('')
    if (!id) return
    try { await callbacks.current.cancel(id) }
    catch (cancelError) { logger.warn('cancel gist oauth failed', cancelError) }
  }, [callbacks, flowID, lifecycle, setError, setFlow, setNotice, setPhase])
}

export function useGistOAuth(callbacks: GistOAuthCallbacks): GistOAuthState {
  const runtime = useGistOAuthRuntime(callbacks)
  const view = useGistOAuthView()
  useGistOAuthUnmount(runtime)
  const pollOnce = useGistOAuthPoll(runtime, view)
  useGistOAuthTimer(view, pollOnce)
  const start = useGistOAuthStart(runtime, view)
  const cancel = useGistOAuthCancel(runtime, view)
  return { phase: view.phase, flow: view.flow, result: view.result, error: view.error, notice: view.notice, start, cancel }
}
