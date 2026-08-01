import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'
import { AutoSaveCoordinator, type AutoSaveRequest } from '@/hooks/autoSaveCoordinator'
import { toast } from '@/components/ui/toast'
import { useSettingsWindowHide } from '@/hooks/useSettingsWindowHide'
import { t } from '@/i18n'

export type AutoSaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

export interface UseAutoSaveOptions<T> {
  value: T
  onSave: (value: T) => Promise<void>
  enabled?: boolean
  isReady?: boolean
  delayMs?: number
  serialize?: (value: T) => string
  baselineRevision?: number
  notify?: boolean
}

export interface UseAutoSaveResult<T> {
  status: AutoSaveStatus
  error: string | null
  flush: () => Promise<void>
  redact: (source: T, redacted: T) => boolean
}

interface LiveOptions<T> {
  value: T
  onSave: (value: T) => Promise<void>
  enabled: boolean
  isReady: boolean
  serialize: (value: T) => string
}

interface NormalizedOptions<T> extends LiveOptions<T> {
  delayMs: number
  baselineRevision: number
}

const defaultSerialize = <T,>(value: T) => JSON.stringify(value)

export function useAutoSave<T>(options: UseAutoSaveOptions<T>): UseAutoSaveResult<T> {
  const normalized = normalizeOptions(options)
  const liveRef = useLiveOptions(normalized)
  const state = useCoordinatorState<T>()
  const timer = useSaveTimer()
  const flush = useFlush(liveRef, state.coordinator, timer.clear)
  const redact = useRedaction(liveRef, state.coordinator)
  useSaveScheduling({ options: normalized, liveRef, state, timer })
  useExitFlush(flush)
  return { status: state.status, error: state.error, flush, redact }
}

function normalizeOptions<T>(options: UseAutoSaveOptions<T>): NormalizedOptions<T> {
  const notify = options.notify ?? false
  const onSave = notify
    ? async (value: T) => {
        try {
          await options.onSave(value)
          toast(t('已自动保存'), 'success')
        } catch (saveError) {
          toast(t('自动保存失败: ${}', saveError instanceof Error ? saveError.message : String(saveError)), 'error')
          throw saveError
        }
      }
    : options.onSave
  return {
    value: options.value,
    onSave,
    enabled: options.enabled ?? true,
    isReady: options.isReady ?? true,
    delayMs: options.delayMs ?? 450,
    serialize: options.serialize ?? defaultSerialize,
    baselineRevision: options.baselineRevision ?? 0,
  }
}

function useLiveOptions<T>(options: LiveOptions<T>) {
  const liveRef = useRef(options)
  liveRef.current = options
  return liveRef
}

function useCoordinatorState<T>() {
  const [status, setStatus] = useState<AutoSaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const coordinatorRef = useRef<AutoSaveCoordinator<T> | null>(null)
  const coordinator = coordinatorRef.current ?? new AutoSaveCoordinator<T>({
    onSaving: () => { setError(null); setStatus('saving') },
    onSaved: () => { setError(null); setStatus('saved') },
    onError: (saveError) => {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
      setStatus('error')
    },
  })
  coordinatorRef.current = coordinator
  return { status, error, setStatus, setError, coordinator }
}

function useSaveTimer() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clear = useCallback(() => {
    if (timerRef.current === null) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])
  return { timerRef, clear }
}

function currentRequest<T>(live: LiveOptions<T>): AutoSaveRequest<T> {
  return {
    value: live.value,
    serialized: live.serialize(live.value),
    save: live.onSave,
  }
}

function useFlush<T>(
  liveRef: RefObject<LiveOptions<T>>,
  coordinator: AutoSaveCoordinator<T>,
  clearTimer: () => void,
) {
  return useCallback(async () => {
    clearTimer()
    const live = liveRef.current
    if (!live.isReady) return
    const request = currentRequest(live)
    const requiresCorrection = coordinator.isActive() && coordinator.isSaved(request.serialized)
    if (!live.enabled && !requiresCorrection) return
    await coordinator.request(request)
  }, [clearTimer, coordinator, liveRef])
}

function useRedaction<T>(liveRef: RefObject<LiveOptions<T>>, coordinator: AutoSaveCoordinator<T>) {
  return useCallback((source: T, redacted: T) => {
    const serialize = liveRef.current.serialize
    return coordinator.redactLatest(serialize(source), serialize(redacted))
  }, [coordinator, liveRef])
}

interface SaveSchedulingState<T> {
  status: AutoSaveStatus
  error: string | null
  setStatus: Dispatch<SetStateAction<AutoSaveStatus>>
  setError: Dispatch<SetStateAction<string | null>>
  coordinator: AutoSaveCoordinator<T>
}

interface SaveSchedulingInput<T> {
  options: NormalizedOptions<T>
  liveRef: RefObject<LiveOptions<T>>
  state: SaveSchedulingState<T>
  timer: ReturnType<typeof useSaveTimer>
}

interface ReadySaveSchedulingInput<T> extends SaveSchedulingInput<T> {
  baselineRef: RefObject<number>
}

function scheduleReadySave<T>({ options, liveRef, state, timer, baselineRef }: ReadySaveSchedulingInput<T>) {
  const { coordinator, setError, setStatus } = state
  const request = currentRequest(liveRef.current)
  if (coordinator.initialize(request.serialized)) {
    baselineRef.current = options.baselineRevision
    setStatus('idle')
    return
  }
  const baselineChanged = baselineRef.current !== options.baselineRevision
  baselineRef.current = options.baselineRevision
  if (baselineChanged) {
    coordinator.synchronize(request.serialized)
    setError(null)
    if (!coordinator.isActive()) setStatus('saved')
    return
  }
  if (coordinator.isSaved(request.serialized)) {
    void coordinator.request(request)
    return
  }
  if (!options.enabled) {
    coordinator.clearPending()
    return
  }
  if (coordinator.isActive()) {
    void coordinator.request(request)
    return
  }
  setError(null)
  setStatus('pending')
  timer.timerRef.current = setTimeout(() => {
    timer.timerRef.current = null
    void coordinator.request(currentRequest(liveRef.current))
  }, options.delayMs)
  return timer.clear
}

function useSaveScheduling<T>({ options, liveRef, state, timer }: SaveSchedulingInput<T>) {
  const readyRef = useRef(options.isReady)
  const baselineRef = useRef(options.baselineRevision)
  const [readyEpoch, setReadyEpoch] = useState(0)
  useEffect(() => {
    timer.clear()
    const becameReady = options.isReady && !readyRef.current
    readyRef.current = options.isReady
    if (becameReady) {
      setReadyEpoch((current) => current + 1)
      return
    }
    if (!options.isReady) {
      state.coordinator.clearPending()
      return
    }
    return scheduleReadySave({ options, liveRef, state, timer, baselineRef })
  }, [liveRef, options.baselineRevision, options.delayMs, options.enabled, options.isReady, options.serialize, options.value, readyEpoch, state.coordinator, state.setError, state.setStatus, timer.clear, timer.timerRef])
}

function useExitFlush(flush: () => Promise<void>) {
  useSettingsWindowHide(() => { void flush() })
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flush()
    }
    const onPageHide = () => { void flush() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      void flush()
    }
  }, [flush])
}
