import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { AssetCatalogService, SessionService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
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
}

export function useSessionAssetCatalog(state: StateSetters) {
  const listAssetCatalogs = useCallback(async () => {
    try {
      const [environmentItems, projectItems, tagItems] = await Promise.all([
        AssetCatalogService.ListEnvironments(), AssetCatalogService.ListProjects(), AssetCatalogService.ListTags(),
      ])
      state.setEnvironments((environmentItems ?? []).map(mapEnvironment))
      state.setProjects((projectItems ?? []).map(mapProject))
      state.setTags((tagItems ?? []).map(mapTag))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('listAssetCatalogs error', error)
      state.setError(message)
      toast(t('加载资产分类失败: ${}', message), 'error')
    }
  }, [state.setEnvironments, state.setError, state.setProjects, state.setTags])

  const refreshAssets = useCallback(async () => {
    try {
      const [environmentItems, projectItems, tagItems, sessionItems, recentItems] = await Promise.all([
        AssetCatalogService.ListEnvironments(), AssetCatalogService.ListProjects(), AssetCatalogService.ListTags(),
        SessionService.ListSessions(null), SessionService.ListRecentSessions(10),
      ])
      state.setEnvironments((environmentItems ?? []).map(mapEnvironment))
      state.setProjects((projectItems ?? []).map(mapProject))
      state.setTags((tagItems ?? []).map(mapTag))
      state.setSessions((sessionItems ?? []).map(mapSession))
      state.setRecentSessions((recentItems ?? []).map(mapSession))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('refreshAssets error', error)
      state.setError(message)
      toast(t('刷新资产数据失败: ${}', message), 'error')
      throw error
    }
  }, [state.setEnvironments, state.setError, state.setProjects, state.setRecentSessions, state.setSessions, state.setTags])

  const createEnvironment = useCallback(async (name: string, colorToken: AssetColorToken) => {
    const result = await AssetCatalogService.CreateEnvironment({ id: 0, name, color_token: colorToken as unknown as BindingAssetColorToken, sort_order: state.environments.length })
    if (!result) throw new Error(t('创建环境失败'))
    const mapped = mapEnvironment(result)
    state.setEnvironments((current) => [...current, mapped])
    return mapped
  }, [state.environments.length, state.setEnvironments])

  const createProject = useCallback(async (name: string, code = '', description = '') => {
    const result = await AssetCatalogService.CreateProject({ id: 0, name, code, description, sort_order: state.projects.length })
    if (!result) throw new Error(t('创建项目失败'))
    const mapped = mapProject(result)
    state.setProjects((current) => [...current, mapped])
    return mapped
  }, [state.projects.length, state.setProjects])

  const createTag = useCallback(async (name: string, colorToken: AssetColorToken) => {
    const result = await AssetCatalogService.CreateTag({ id: 0, name, color_token: colorToken as unknown as BindingAssetColorToken })
    if (!result) throw new Error(t('创建标签失败'))
    const mapped = mapTag(result)
    state.setTags((current) => [...current, mapped])
    return mapped
  }, [state.setTags])

  const updateEnvironment = useCallback(async (item: AssetEnvironment) => {
    await AssetCatalogService.UpdateEnvironment({ id: Number(item.id), name: item.name, color_token: item.colorToken as unknown as BindingAssetColorToken, sort_order: item.sortOrder })
    await refreshAssets()
  }, [refreshAssets])
  const updateProject = useCallback(async (item: AssetProject) => {
    await AssetCatalogService.UpdateProject({ id: Number(item.id), name: item.name, code: item.code, description: item.description, sort_order: item.sortOrder })
    await refreshAssets()
  }, [refreshAssets])
  const updateTag = useCallback(async (item: AssetTag) => {
    await AssetCatalogService.UpdateTag({ id: Number(item.id), name: item.name, color_token: item.colorToken as unknown as BindingAssetColorToken })
    await refreshAssets()
  }, [refreshAssets])
  const deleteEnvironment = useCallback(async (input: AssetDeleteInput) => { await AssetCatalogService.DeleteEnvironment(input); await refreshAssets() }, [refreshAssets])
  const deleteProject = useCallback(async (input: AssetDeleteInput) => { await AssetCatalogService.DeleteProject(input); await refreshAssets() }, [refreshAssets])
  const deleteTag = useCallback(async (id: string) => { await AssetCatalogService.DeleteTag(Number(id)); await refreshAssets() }, [refreshAssets])
  const reorderEnvironments = useCallback(async (ids: string[]) => { await AssetCatalogService.ReorderEnvironments(ids.map(Number)); await refreshAssets() }, [refreshAssets])
  const reorderProjects = useCallback(async (ids: string[]) => { await AssetCatalogService.ReorderProjects(ids.map(Number)); await refreshAssets() }, [refreshAssets])
  const bulkSetEnvironment = useCallback(async (sessionIDs: string[], targetID: string | null) => {
    const count = await AssetCatalogService.BulkSetEnvironment({ session_ids: sessionIDs.map(Number), target_id: targetID ? Number(targetID) : null })
    await refreshAssets(); return count
  }, [refreshAssets])
  const bulkSetProject = useCallback(async (sessionIDs: string[], targetID: string | null) => {
    const count = await AssetCatalogService.BulkSetProject({ session_ids: sessionIDs.map(Number), target_id: targetID ? Number(targetID) : null })
    await refreshAssets(); return count
  }, [refreshAssets])
  const bulkUpdateTags = useCallback(async (sessionIDs: string[], tagIDs: string[], operation: 'add' | 'remove' | 'replace') => {
    const count = await AssetCatalogService.BulkUpdateTags({ session_ids: sessionIDs.map(Number), tag_ids: tagIDs.map(Number), operation })
    await refreshAssets(); return count
  }, [refreshAssets])

  return { listAssetCatalogs, createEnvironment, createProject, createTag, updateEnvironment, updateProject, updateTag, deleteEnvironment, deleteProject, deleteTag, reorderEnvironments, reorderProjects, bulkSetEnvironment, bulkSetProject, bulkUpdateTags, refreshAssets }
}
