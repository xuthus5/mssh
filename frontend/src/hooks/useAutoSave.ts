import { useCallback, useEffect, useRef, useState } from 'react'

export type AutoSaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

export interface UseAutoSaveOptions<T> {
  value: T
  onSave: (value: T) => Promise<void>
  enabled?: boolean
  isReady?: boolean
  delayMs?: number
  serialize?: (value: T) => string
}

export interface UseAutoSaveResult {
  status: AutoSaveStatus
  error: string | null
  flush: () => Promise<void>
}

const defaultSerialize = <T,>(value: T) => JSON.stringify(value)

export function useAutoSave<T>({
  value,
  onSave,
  enabled = true,
  isReady = true,
  delayMs = 450,
  serialize = defaultSerialize,
}: UseAutoSaveOptions<T>): UseAutoSaveResult {
  const [status, setStatus] = useState<AutoSaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const lastSavedRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const valueRef = useRef(value)
  const onSaveRef = useRef(onSave)
  const serializeRef = useRef(serialize)
  const saveGenerationRef = useRef(0)
  const inFlightRef = useRef(false)
  const queuedRef = useRef(false)
  const enabledRef = useRef(enabled)
  const isReadyRef = useRef(isReady)

  valueRef.current = value
  onSaveRef.current = onSave
  serializeRef.current = serialize
  enabledRef.current = enabled
  isReadyRef.current = isReady

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const persist = useCallback(async () => {
    if (!enabledRef.current || !isReadyRef.current) return
    const snapshot = valueRef.current
    const serialized = serializeRef.current(snapshot)
    if (lastSavedRef.current === serialized) {
      setStatus((current) => (current === 'pending' || current === 'saving' ? 'saved' : current))
      return
    }
    if (inFlightRef.current) {
      queuedRef.current = true
      return
    }
    inFlightRef.current = true
    const generation = ++saveGenerationRef.current
    setStatus('saving')
    setError(null)
    try {
      await onSaveRef.current(snapshot)
      if (generation !== saveGenerationRef.current) return
      lastSavedRef.current = serializeRef.current(snapshot)
      setStatus('saved')
    } catch (saveError) {
      if (generation !== saveGenerationRef.current) return
      setError(saveError instanceof Error ? saveError.message : String(saveError))
      setStatus('error')
    } finally {
      inFlightRef.current = false
      if (queuedRef.current) {
        queuedRef.current = false
        void persist()
      }
    }
  }, [])

  const flush = useCallback(async () => {
    clearTimer()
    await persist()
  }, [clearTimer, persist])

  useEffect(() => {
    if (!isReady) return
    const serialized = serializeRef.current(value)
    if (lastSavedRef.current === null) {
      lastSavedRef.current = serialized
      setStatus('idle')
      return
    }
    if (!enabled || lastSavedRef.current === serialized) return
    setStatus('pending')
    clearTimer()
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void persist()
    }, delayMs)
    return clearTimer
  }, [value, enabled, isReady, delayMs, clearTimer, persist])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flush()
    }
    const onPageHide = () => {
      void flush()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      clearTimer()
    }
  }, [flush, clearTimer])

  return { status, error, flush }
}
