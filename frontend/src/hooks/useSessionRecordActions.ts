import { useCallback, type Dispatch, type SetStateAction } from 'react'
import type { SessionInput } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { SessionService } from '@/lib/wails'
import { useConnectDialog } from '@/store/connectDialog'
import { logger } from '@/lib/logger'
import { mapSession, type Session } from '@/lib/sessionModels'
import { cancelTransfersForSessions, closeTerminalTabsForSessions } from '@/hooks/sessionTabLifecycle'
import { SessionMutationTracker } from '@/hooks/sessionMutationTracker'

interface SessionActionOptions {
  captureLifecycle: () => () => boolean
  beginSessionMutation: (id: string) => number
  sessionMutationTracker: SessionMutationTracker
  listAssetCatalogs: (options?: { silent?: boolean }) => Promise<void>
  setSessions: Dispatch<SetStateAction<Session[]>>
  setRecentSessions: Dispatch<SetStateAction<Session[]>>
}

type SessionDraft = Omit<Session, 'id'> | Session

function toSessionInput(session: SessionDraft, id: number): SessionInput {
  return {
    id,
    name: session.name,
    host: session.host,
    port: session.port,
    username: session.username,
    notes: session.notes ?? '',
    environment_id: session.environmentId ? Number(session.environmentId) : null,
    project_id: session.projectId ? Number(session.projectId) : null,
    tag_ids: (session.tags ?? []).map((tag) => Number(tag.id)),
    auth_method: session.authMethod as SessionInput['auth_method'],
    password: session.password,
    key_id: session.keyId ? Number(session.keyId) : null,
    keep_alive: session.keepAlive,
    term_type: session.termType,
    folder_id: session.folderId ? Number(session.folderId) : null,
    sort_order: 0,
  }
}

async function refreshAssetCatalog(options: SessionActionOptions, operation: string) {
  try {
    await options.listAssetCatalogs({ silent: true })
  } catch (error) {
    logger.error(`${operation} catalog refresh failed`, error)
  }
}

function useCreateSession(options: SessionActionOptions) {
  return useCallback(async (session: Omit<Session, 'id'>) => {
    const isActive = options.captureLifecycle()
    try {
      const result = await SessionService.CreateSession(toSessionInput(session, 0))
      if (!result || !isActive()) return
      const mapped = mapSession(result)
      const mutation = options.beginSessionMutation(mapped.id)
      options.setSessions((previous) => [...previous, mapped])
      options.sessionMutationTracker.finish(mapped.id, mutation)
      await refreshAssetCatalog(options, 'createSession')
    } catch (error) {
      logger.error('createSession error', error)
      throw error
    }
  }, [options])
}

function applyOptimisticSession(session: Session, options: SessionActionOptions) {
  const optimistic = { ...session, password: undefined }
  options.setSessions((previous) => previous.map((item) => (item.id === session.id ? optimistic : item)))
  options.setRecentSessions((previous) => previous.map((item) => (item.id === session.id ? { ...item, ...optimistic } : item)))
}

async function refreshUpdatedSession({ session, mutation, isActive, options }: {
  session: Session
  mutation: number
  isActive: () => boolean
  options: SessionActionOptions
}) {
  try {
    const refreshed = await SessionService.GetSession(Number(session.id))
    if (!refreshed || !isActive() || !options.sessionMutationTracker.isCurrent(session.id, mutation)) return
    const mapped = mapSession(refreshed)
    options.setSessions((previous) => previous.map((item) => (item.id === session.id ? mapped : item)))
    options.setRecentSessions((previous) => previous.map((item) => (item.id === session.id ? mapped : item)))
  } catch (error) {
    logger.error('updateSession getSession refresh failed', error)
  } finally {
    options.sessionMutationTracker.finish(session.id, mutation)
  }
}

function useUpdateSession(options: SessionActionOptions) {
  return useCallback(async (session: Session) => {
    const isActive = options.captureLifecycle()
    try {
      await SessionService.UpdateSession(toSessionInput(session, Number(session.id)))
    } catch (error) {
      logger.error('updateSession error', error)
      throw error
    }
    // Persist already succeeded; hydrate list from payload, then best-effort server refresh.
    if (!isActive()) return
    const mutation = options.beginSessionMutation(session.id)
    applyOptimisticSession(session, options)
    await refreshUpdatedSession({ session, mutation, isActive, options })
    await refreshAssetCatalog(options, 'updateSession')
  }, [options])
}

function useDeleteSession(options: SessionActionOptions) {
  return useCallback(async (id: string) => {
    const isActive = options.captureLifecycle()
    try {
      await SessionService.DeleteSession(Number(id))
      if (!isActive()) return
      const mutation = options.beginSessionMutation(id)
      try {
        options.setSessions((previous) => previous.filter((session) => session.id !== id))
        options.setRecentSessions((previous) => previous.filter((session) => session.id !== id))
        useConnectDialog.getState().dismissForSessions([id])
        cancelTransfersForSessions([id])
        await closeTerminalTabsForSessions([id])
      } finally {
        options.sessionMutationTracker.finish(id, mutation)
      }
    } catch (error) {
      logger.error('deleteSession error', error)
      throw error
    }
  }, [options])
}

function useMoveSession(options: SessionActionOptions) {
  return useCallback(async (id: string, folderId: string | null) => {
    const isActive = options.captureLifecycle()
    try {
      await SessionService.MoveSession(Number(id), folderId ? Number(folderId) : null)
      if (!isActive()) return
      const mutation = options.beginSessionMutation(id)
      options.setSessions((previous) => previous.map((session) => (session.id === id ? { ...session, folderId } : session)))
      options.setRecentSessions((previous) => previous.map((session) => (session.id === id ? { ...session, folderId } : session)))
      options.sessionMutationTracker.finish(id, mutation)
    } catch (error) {
      logger.error('moveSession error', error)
      throw error
    }
  }, [options])
}

export function useSessionRecordActions(options: SessionActionOptions) {
  return {
    createSession: useCreateSession(options),
    updateSession: useUpdateSession(options),
    deleteSession: useDeleteSession(options),
    moveSession: useMoveSession(options),
  }
}
