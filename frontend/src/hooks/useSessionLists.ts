import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { SessionService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { mapFolder, mapSession, type Folder, type Session } from '@/lib/sessionModels'

type IsCurrent = () => boolean

interface Options {
  captureLifecycle: () => IsCurrent
  beginSessionSnapshot: () => IsCurrent
  beginRecentSnapshot: () => IsCurrent
  finishLoad: (isActive: IsCurrent) => void
  activeLoads: MutableRefObject<number>
  folderRequest: MutableRefObject<number>
  setFolders: Dispatch<SetStateAction<Folder[]>>
  setSessions: Dispatch<SetStateAction<Session[]>>
  setRecentSessions: Dispatch<SetStateAction<Session[]>>
  setLoading: Dispatch<SetStateAction<boolean>>
  setSessionsLoaded: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string>>
}

export function useSessionLists(options: Options) {
  const listFolders = useFolderList(options)
  const listSessions = useAllSessionsList(options)
  const listRecentSessions = useRecentSessionsList(options)
  return { listFolders, listSessions, listRecentSessions }
}

function useFolderList(options: Options) {
  const { captureLifecycle, finishLoad, activeLoads, folderRequest, setFolders, setLoading, setError } = options
  const listFolders = useCallback(async (settings?: { silent?: boolean }) => {
    const isActive = captureLifecycle()
    const request = ++folderRequest.current
    if (!isActive()) return
    activeLoads.current++
    setLoading(true)
    setError('')
    try {
      const result = await SessionService.ListFolders()
      if (isActive() && folderRequest.current === request) {
        setFolders((result ?? []).map(mapFolder))
        setError('')
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('listFolders error', error)
      if (isActive() && folderRequest.current === request) setError(message)
      if (settings?.silent && isActive() && folderRequest.current === request) throw error
    } finally {
      finishLoad(isActive)
    }
  }, [activeLoads, captureLifecycle, finishLoad, folderRequest, setError, setFolders, setLoading])
  return listFolders
}

function useAllSessionsList(options: Options) {
  const { captureLifecycle, beginSessionSnapshot, finishLoad, activeLoads, setSessions, setLoading, setSessionsLoaded, setError } = options
  const listSessions = useCallback(async (settings?: { silent?: boolean }) => {
    const isActive = captureLifecycle()
    const isCurrent = beginSessionSnapshot()
    if (!isActive()) return
    activeLoads.current++
    setLoading(true)
    setError('')
    try {
      const result = await SessionService.ListSessions(null)
      if (isCurrent()) {
        setSessions((result ?? []).map(mapSession))
        setError('')
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('listSessions error', error)
      if (isCurrent()) setError(message)
      if (settings?.silent && isCurrent()) throw error
    } finally {
      finishLoad(isActive)
      if (isCurrent()) setSessionsLoaded(true)
    }
  }, [activeLoads, beginSessionSnapshot, captureLifecycle, finishLoad, setError, setLoading, setSessions, setSessionsLoaded])
  return listSessions
}

function useRecentSessionsList(options: Options) {
  const { captureLifecycle, beginRecentSnapshot, finishLoad, activeLoads, setRecentSessions, setError } = options
  const listRecentSessions = useCallback(async (settings?: { silent?: boolean }) => {
    const isActive = captureLifecycle()
    const isCurrent = beginRecentSnapshot()
    if (!isActive()) return
    activeLoads.current++
    try {
      const result = await SessionService.ListRecentSessions(10)
      if (isCurrent()) {
        setRecentSessions((result ?? []).map(mapSession))
        setError('')
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('listRecentSessions error', error)
      if (isCurrent()) setError(message)
      if (settings?.silent && isCurrent()) throw error
    } finally {
      finishLoad(isActive)
    }
  }, [activeLoads, beginRecentSnapshot, captureLifecycle, finishLoad, setError, setRecentSessions])
  return listRecentSessions
}
