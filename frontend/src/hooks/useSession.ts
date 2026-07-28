import { useState, useEffect, useMemo, useRef } from 'react'
import { type AssetEnvironment, type AssetProject, type AssetTag, type Folder, type Session } from '@/lib/sessionModels'
import { useSessionAssetCatalog } from '@/hooks/useSessionAssetCatalog'
import { useSessionCSVTransfer } from '@/hooks/useSessionCSVTransfer'
import { useSessionConnectionActions } from '@/hooks/useSessionConnectionActions'
import { useSessionLists } from '@/hooks/useSessionLists'
import { SessionMutationTracker } from '@/hooks/sessionMutationTracker'
import { useSessionLifecycle, useSessionRequests } from '@/hooks/sessionRequestRuntime'
import { useSessionFolderActions } from '@/hooks/useSessionFolderActions'
import { useSessionRecordActions } from '@/hooks/useSessionRecordActions'


export type { BatchSessionResult } from '@/lib/sessionBatch'
export type { AssetColorToken, AssetEnvironment, AssetProject, AssetTag, Folder, Session, Tunnel } from '@/lib/sessionModels'

function useSessionCollections() {
  const [folders, setFolders] = useState<Folder[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const foldersRef = useRef(folders)
  const sessionsRef = useRef(sessions)
  foldersRef.current = folders
  sessionsRef.current = sessions
  const [recentSessions, setRecentSessions] = useState<Session[]>([])
  const recentSessionsRef = useRef(recentSessions)
  recentSessionsRef.current = recentSessions
  const [environments, setEnvironments] = useState<AssetEnvironment[]>([])
  const [projects, setProjects] = useState<AssetProject[]>([])
  const [tags, setTags] = useState<AssetTag[]>([])
  const [loading, setLoading] = useState(false)
  const [sessionsLoaded, setSessionsLoaded] = useState(false)
  const [error, setError] = useState('')
  return {
    folders, setFolders, foldersRef, sessions, setSessions, sessionsRef,
    recentSessions, setRecentSessions, recentSessionsRef, environments, setEnvironments,
    projects, setProjects, tags, setTags, loading, setLoading, sessionsLoaded, setSessionsLoaded,
    error, setError,
  }
}

type SessionCollections = ReturnType<typeof useSessionCollections>

function useInitialSessionLoad(loaders: {
  listFolders: () => Promise<void>
  listSessions: () => Promise<void>
  listRecentSessions: () => Promise<void>
  listAssetCatalogs: (options?: { silent?: boolean }) => Promise<void>
}) {
  useEffect(() => {
    void loaders.listFolders()
    void loaders.listSessions()
    void loaders.listRecentSessions()
    void loaders.listAssetCatalogs()
  }, [loaders.listAssetCatalogs, loaders.listFolders, loaders.listRecentSessions, loaders.listSessions])
}

function useSessionMutationActions({ collections, requests, captureLifecycle, sessionMutationTracker, listFolders, refreshAssets, listAssetCatalogs }: {
  collections: SessionCollections
  requests: ReturnType<typeof useSessionRequests>
  captureLifecycle: () => () => boolean
  sessionMutationTracker: SessionMutationTracker
  listFolders: () => Promise<void>
  refreshAssets: () => Promise<void>
  listAssetCatalogs: (options?: { silent?: boolean }) => Promise<void>
}) {
  const folderOptions = useMemo(() => ({
    captureLifecycle, invalidateFolderRequests: requests.invalidateFolderRequests,
    invalidateSessionMutations: requests.invalidateSessionMutations,
    foldersRef: collections.foldersRef, sessionsRef: collections.sessionsRef,
    recentSessionsRef: collections.recentSessionsRef, setFolders: collections.setFolders,
    setSessions: collections.setSessions, setRecentSessions: collections.setRecentSessions,
  }), [captureLifecycle, collections.foldersRef, collections.recentSessionsRef, collections.sessionsRef,
    collections.setFolders, collections.setRecentSessions, collections.setSessions,
    requests.invalidateFolderRequests, requests.invalidateSessionMutations])
  const sessionOptions = useMemo(() => ({
    captureLifecycle, beginSessionMutation: requests.beginSessionMutation, sessionMutationTracker,
    listAssetCatalogs, setSessions: collections.setSessions, setRecentSessions: collections.setRecentSessions,
  }), [captureLifecycle, collections.setRecentSessions, collections.setSessions, listAssetCatalogs,
    requests.beginSessionMutation, sessionMutationTracker])
  return {
    folderActions: useSessionFolderActions(folderOptions),
    sessionActions: useSessionRecordActions(sessionOptions),
    csvTransfer: useSessionCSVTransfer({ refreshFolders: listFolders, refreshAssets }),
  }
}

export function useSession() {
  const collections = useSessionCollections()
  const [sessionMutationTracker] = useState(() => new SessionMutationTracker())
  const { lifecycle, captureLifecycle } = useSessionLifecycle()
  const requests = useSessionRequests(sessionMutationTracker, lifecycle, collections.setLoading)
  const assetCatalog = useSessionAssetCatalog({
    environments: collections.environments, projects: collections.projects,
    setEnvironments: collections.setEnvironments, setProjects: collections.setProjects,
    setTags: collections.setTags, setSessions: collections.setSessions,
    setRecentSessions: collections.setRecentSessions, setError: collections.setError,
    beginSessionSnapshot: requests.beginSessionSnapshot, beginRecentSnapshot: requests.beginRecentSnapshot,
  })
  const { listAssetCatalogs, refreshAssets } = assetCatalog
  const { listFolders, listSessions, listRecentSessions } = useSessionLists({
    captureLifecycle, beginSessionSnapshot: requests.beginSessionSnapshot,
    beginRecentSnapshot: requests.beginRecentSnapshot, finishLoad: requests.finishLoad,
    activeLoads: requests.activeLoads, folderRequest: requests.folderRequest,
    setFolders: collections.setFolders, setSessions: collections.setSessions,
    setRecentSessions: collections.setRecentSessions, setLoading: collections.setLoading,
    setSessionsLoaded: collections.setSessionsLoaded, setError: collections.setError,
  })
  const { folderActions, sessionActions, csvTransfer } = useSessionMutationActions({
    collections, requests, captureLifecycle, sessionMutationTracker,
    listFolders, refreshAssets, listAssetCatalogs,
  })
  const connection = useSessionConnectionActions({
    sessions: collections.sessions,
    setSessions: collections.setSessions,
    setRecentSessions: collections.setRecentSessions,
    listSessions,
    listRecentSessions,
    refreshAssets,
  })
  useInitialSessionLoad({ listFolders, listSessions, listRecentSessions, listAssetCatalogs })
  return {
    folders: collections.folders, sessions: collections.sessions, recentSessions: collections.recentSessions,
    environments: collections.environments, projects: collections.projects, tags: collections.tags,
    loading: collections.loading, sessionsLoaded: collections.sessionsLoaded, error: collections.error,
    listFolders, ...folderActions, listSessions, listRecentSessions, ...sessionActions,
    ...connection,
    ...csvTransfer,
    ...assetCatalog,
  }
}
