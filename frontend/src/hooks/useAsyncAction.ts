import { useCallback, useEffect, useRef, useState } from 'react'

export type AsyncStatus = 'idle' | 'pending' | 'success' | 'error'

interface AsyncState<TResult> {
  status: AsyncStatus
  result?: TResult
  error: string
}

export function useAsyncAction<TArguments extends unknown[], TResult>(action: (...arguments_: TArguments) => Promise<TResult>, mode: 'dedupe' | 'latest' = 'dedupe') {
  const [state, setState] = useState<AsyncState<TResult>>({ status: 'idle', error: '' })
  const inFlight = useRef<Promise<TResult> | null>(null)
  const sequence = useRef(0)
  const lifecycle = useRef(0)
  const mounted = useRef(false)
  useEffect(() => {
    const token = ++lifecycle.current
    mounted.current = true
    return () => {
      if (lifecycle.current !== token) return
      lifecycle.current++
      mounted.current = false
      sequence.current++
      inFlight.current = null
    }
  }, [])
  const run = useCallback((...arguments_: TArguments): Promise<TResult> => {
    if (mode === 'dedupe' && inFlight.current) return inFlight.current
    const request = ++sequence.current
    const lifecycleToken = lifecycle.current
    const isCurrent = () => mounted.current && lifecycle.current === lifecycleToken && request === sequence.current
    setState((current) => ({ ...current, status: 'pending', error: '' }))
    const promise = action(...arguments_).then((result) => {
      if (isCurrent()) setState({ status: 'success', result, error: '' })
      return result
    }).catch((error: unknown) => {
      if (isCurrent()) setState((current) => ({ ...current, status: 'error', error: error instanceof Error ? error.message : String(error) }))
      throw error
    }).finally(() => {
      if (inFlight.current === promise) inFlight.current = null
    })
    inFlight.current = promise
    return promise
  }, [action, mode])
  const reset = useCallback(() => { sequence.current++; inFlight.current = null; setState({ status: 'idle', error: '' }) }, [])
  return { ...state, pending: state.status === 'pending', run, reset }
}
