import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { SessionMutationTracker } from '@/hooks/sessionMutationTracker'

export function useSessionLifecycle() {
  const lifecycle = useRef(0)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [])
  const captureLifecycle = useCallback(() => {
    const token = lifecycle.current
    return () => lifecycle.current === token
  }, [])
  return { lifecycle, captureLifecycle }
}

export function useSessionRequests(
  sessionMutationTracker: SessionMutationTracker,
  lifecycle: MutableRefObject<number>,
  setLoading: Dispatch<SetStateAction<boolean>>,
) {
  const folderRequest = useRef(0)
  const sessionRequest = useRef(0)
  const recentRequest = useRef(0)
  const activeLoads = useRef(0)
  const invalidateFolderRequests = useCallback(() => { folderRequest.current++ }, [])
  const beginSessionMutation = useCallback((id: string) => {
    const generation = sessionMutationTracker.begin(id)
    sessionRequest.current++
    recentRequest.current++
    return generation
  }, [sessionMutationTracker])
  const invalidateSessionMutations = useCallback((ids: string[]) => {
    sessionMutationTracker.invalidate(ids)
    sessionRequest.current++
    recentRequest.current++
  }, [sessionMutationTracker])
  const finishLoad = useCallback((isActive: () => boolean) => {
    activeLoads.current = Math.max(0, activeLoads.current - 1)
    if (isActive() && activeLoads.current === 0) setLoading(false)
  }, [setLoading])
  const beginSessionSnapshot = useCallback(() => {
    const lifecycleToken = lifecycle.current
    const request = ++sessionRequest.current
    return () => lifecycle.current === lifecycleToken && sessionRequest.current === request
  }, [lifecycle])
  const beginRecentSnapshot = useCallback(() => {
    const lifecycleToken = lifecycle.current
    const request = ++recentRequest.current
    return () => lifecycle.current === lifecycleToken && recentRequest.current === request
  }, [lifecycle])
  return {
    folderRequest, sessionRequest, recentRequest, activeLoads, invalidateFolderRequests,
    beginSessionMutation, invalidateSessionMutations, finishLoad, beginSessionSnapshot, beginRecentSnapshot,
  }
}
