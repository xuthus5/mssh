import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { AssetCatalogService, SessionService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { t } from '@/i18n'
import { mapEnvironment, mapProject, mapSession, mapTag, type AssetColorToken, type AssetEnvironment, type AssetProject, type AssetTag, type Session } from '@/lib/sessionModels'
import type { AssetColorToken as BindingAssetColorToken, AssetDeleteInput } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'


interface StateSetters {
  environments: AssetEnvironment[]
  projects: AssetProject[]
  setEnvironments: Dispatch<SetStateAction<AssetEnvironment[]>>
  setProjects: Dispatch<SetStateAction<AssetProject[]>>
  setTags: Dispatch<SetStateAction<AssetTag[]>>
  setSessions: Dispatch<SetStateAction<Session[]>>
  setRecentSessions: Dispatch<SetStateAction<Session[]>>
  setError: Dispatch<SetStateAction<string>>
  beginSessionSnapshot: () => () => boolean
  beginRecentSnapshot: () => () => boolean
}


async function silentRefreshAssets(refreshAssets: (options?: { silent?: boolean }) => Promise<void>, context: string) {
  try {
    await refreshAssets({ silent: true })
  } catch (refreshError) {
    logger.error(`${context} post-refresh failed`, refreshError)
  }
}

function useCatalogRequestGate() {
  const lifecycle = useRef(0)
  const requestID = useRef(0)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => {
      if (lifecycle.current === token) lifecycle.current++
    }
  }, [])
  const beginRequest = useCallback(() => {
    const lifecycleToken = lifecycle.current
    const currentRequest = ++requestID.current
    return () => lifecycle.current === lifecycleToken && requestID.current === currentRequest
  }, [])
  const captureLifecycle = useCallback(() => {
    const lifecycleToken = lifecycle.current
    return () => lifecycle.current === lifecycleToken
  }, [])
  const invalidateRequests = useCallback(() => { requestID.current++ }, [])
  return { beginRequest, captureLifecycle, invalidateRequests }
}

function useCatalogList(state: StateSetters, beginRequest: () => () => boolean) {
  return useCallback(async (options?: { silent?: boolean }) => {
    const isCurrent = beginRequest()
    try {
      const [environmentItems, projectItems, tagItems] = await Promise.all([
        AssetCatalogService.ListEnvironments(), AssetCatalogService.ListProjects(), AssetCatalogService.ListTags(),
      ])
      if (!isCurrent()) return
      state.setEnvironments((environmentItems ?? []).map(mapEnvironment))
      state.setProjects((projectItems ?? []).map(mapProject))
      state.setTags((tagItems ?? []).map(mapTag))
      state.setError('')
    } catch (error) {
      if (!isCurrent()) return
      const message = error instanceof Error ? error.message : String(error)
      logger.error('listAssetCatalogs error', error)
      state.setError(message)
      if (options?.silent) throw error
    }
  }, [beginRequest, state.setEnvironments, state.setError, state.setProjects, state.setTags])
}

function useAssetRefresh(state: StateSetters, beginRequest: () => () => boolean) {
  return useCallback(async (options?: { silent?: boolean }) => {
    const isCatalogCurrent = beginRequest()
    const isSessionCurrent = state.beginSessionSnapshot()
    const isRecentCurrent = state.beginRecentSnapshot()
    try {
      const [environmentItems, projectItems, tagItems, sessionItems, recentItems] = await Promise.all([
        AssetCatalogService.ListEnvironments(), AssetCatalogService.ListProjects(), AssetCatalogService.ListTags(),
        SessionService.ListSessions(null), SessionService.ListRecentSessions(10),
      ])
      if (isCatalogCurrent()) {
        state.setEnvironments((environmentItems ?? []).map(mapEnvironment))
        state.setProjects((projectItems ?? []).map(mapProject))
        state.setTags((tagItems ?? []).map(mapTag))
        state.setError('')
      }
      if (isSessionCurrent()) state.setSessions((sessionItems ?? []).map(mapSession))
      if (isRecentCurrent()) state.setRecentSessions((recentItems ?? []).map(mapSession))
    } catch (error) {
      if (!isCatalogCurrent()) return
      const message = error instanceof Error ? error.message : String(error)
      logger.error('refreshAssets error', error)
      state.setError(message)
      if (options?.silent) throw error
      // non-silent: page banner owns the failure
    }
  }, [beginRequest, state.beginRecentSnapshot, state.beginSessionSnapshot, state.setEnvironments, state.setError, state.setProjects, state.setRecentSessions, state.setSessions, state.setTags])
}

function useCatalogCreators(
  state: StateSetters,
  captureLifecycle: () => () => boolean,
  invalidateRequests: () => void,
) {
  const createEnvironment = useCallback(async (name: string, colorToken: AssetColorToken) => {
    const isActive = captureLifecycle()
    const result = await AssetCatalogService.CreateEnvironment({ id: 0, name, color_token: colorToken as unknown as BindingAssetColorToken, sort_order: state.environments.length })
    if (!result) throw new Error(t('创建环境失败'))
    const mapped = mapEnvironment(result)
    if (isActive()) {
      invalidateRequests()
      state.setEnvironments((current) => [...current, mapped])
    }
    return mapped
  }, [captureLifecycle, invalidateRequests, state.environments.length, state.setEnvironments])

  const createProject = useCallback(async (name: string, code = '', description = '') => {
    const isActive = captureLifecycle()
    const result = await AssetCatalogService.CreateProject({ id: 0, name, code, description, sort_order: state.projects.length })
    if (!result) throw new Error(t('创建项目失败'))
    const mapped = mapProject(result)
    if (isActive()) {
      invalidateRequests()
      state.setProjects((current) => [...current, mapped])
    }
    return mapped
  }, [captureLifecycle, invalidateRequests, state.projects.length, state.setProjects])

  const createTag = useCallback(async (name: string, colorToken: AssetColorToken) => {
    const isActive = captureLifecycle()
    const result = await AssetCatalogService.CreateTag({ id: 0, name, color_token: colorToken as unknown as BindingAssetColorToken })
    if (!result) throw new Error(t('创建标签失败'))
    const mapped = mapTag(result)
    if (isActive()) {
      invalidateRequests()
      state.setTags((current) => [...current, mapped])
    }
    return mapped
  }, [captureLifecycle, invalidateRequests, state.setTags])
  return { createEnvironment, createProject, createTag }
}

function useCatalogMutations(refreshAssets: (options?: { silent?: boolean }) => Promise<void>) {
  const updateEnvironment = useCallback(async (item: AssetEnvironment) => {
    await AssetCatalogService.UpdateEnvironment({ id: Number(item.id), name: item.name, color_token: item.colorToken as unknown as BindingAssetColorToken, sort_order: item.sortOrder })
    await silentRefreshAssets(refreshAssets, 'updateEnvironment')
  }, [refreshAssets])
  const updateProject = useCallback(async (item: AssetProject) => {
    await AssetCatalogService.UpdateProject({ id: Number(item.id), name: item.name, code: item.code, description: item.description, sort_order: item.sortOrder })
    await silentRefreshAssets(refreshAssets, 'updateProject')
  }, [refreshAssets])
  const updateTag = useCallback(async (item: AssetTag) => {
    await AssetCatalogService.UpdateTag({ id: Number(item.id), name: item.name, color_token: item.colorToken as unknown as BindingAssetColorToken })
    await silentRefreshAssets(refreshAssets, 'updateTag')
  }, [refreshAssets])
  const deleteEnvironment = useCallback(async (input: AssetDeleteInput) => {
    await AssetCatalogService.DeleteEnvironment(input)
    await silentRefreshAssets(refreshAssets, 'deleteEnvironment')
  }, [refreshAssets])
  const deleteProject = useCallback(async (input: AssetDeleteInput) => {
    await AssetCatalogService.DeleteProject(input)
    await silentRefreshAssets(refreshAssets, 'deleteProject')
  }, [refreshAssets])
  const deleteTag = useCallback(async (id: string) => {
    await AssetCatalogService.DeleteTag(Number(id))
    await silentRefreshAssets(refreshAssets, 'deleteTag')
  }, [refreshAssets])
  const reorderEnvironments = useCallback(async (ids: string[]) => {
    await AssetCatalogService.ReorderEnvironments(ids.map(Number))
    await silentRefreshAssets(refreshAssets, 'reorderEnvironments')
  }, [refreshAssets])
  const reorderProjects = useCallback(async (ids: string[]) => {
    await AssetCatalogService.ReorderProjects(ids.map(Number))
    await silentRefreshAssets(refreshAssets, 'reorderProjects')
  }, [refreshAssets])
  return { updateEnvironment, updateProject, updateTag, deleteEnvironment, deleteProject, deleteTag, reorderEnvironments, reorderProjects }
}

function useCatalogBulkMutations(refreshAssets: (options?: { silent?: boolean }) => Promise<void>) {
  const bulkSetEnvironment = useCallback(async (sessionIDs: string[], targetID: string | null) => {
    const count = await AssetCatalogService.BulkSetEnvironment({ session_ids: sessionIDs.map(Number), target_id: targetID ? Number(targetID) : null })
    await silentRefreshAssets(refreshAssets, 'bulkSetEnvironment')
    return count
  }, [refreshAssets])
  const bulkSetProject = useCallback(async (sessionIDs: string[], targetID: string | null) => {
    const count = await AssetCatalogService.BulkSetProject({ session_ids: sessionIDs.map(Number), target_id: targetID ? Number(targetID) : null })
    await silentRefreshAssets(refreshAssets, 'bulkSetProject')
    return count
  }, [refreshAssets])
  const bulkUpdateTags = useCallback(async (sessionIDs: string[], tagIDs: string[], operation: 'add' | 'remove' | 'replace') => {
    const count = await AssetCatalogService.BulkUpdateTags({ session_ids: sessionIDs.map(Number), tag_ids: tagIDs.map(Number), operation })
    await silentRefreshAssets(refreshAssets, 'bulkUpdateTags')
    return count
  }, [refreshAssets])
  return { bulkSetEnvironment, bulkSetProject, bulkUpdateTags }
}

export function useSessionAssetCatalog(state: StateSetters) {
  const gate = useCatalogRequestGate()
  const listAssetCatalogs = useCatalogList(state, gate.beginRequest)
  const refreshAssets = useAssetRefresh(state, gate.beginRequest)
  return {
    listAssetCatalogs,
    refreshAssets,
    ...useCatalogCreators(state, gate.captureLifecycle, gate.invalidateRequests),
    ...useCatalogMutations(refreshAssets),
    ...useCatalogBulkMutations(refreshAssets),
  }
}
