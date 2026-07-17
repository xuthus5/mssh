import type { Folder, Session } from '@/lib/sessionModels'

export interface SessionAssetFilters {
  query: string
  environmentIds: string[]
  projectIds: string[]
  tagIds: string[]
  includeUnsetEnvironment: boolean
  includeUnsetProject: boolean
  includeUntagged: boolean
  notesQuery: string
  connectedAfter: string
  connectedBefore: string
  minConnections: number | null
  maxConnections: number | null
}

export const emptySessionAssetFilters: SessionAssetFilters = {
  query: '', environmentIds: [], projectIds: [], tagIds: [], includeUnsetEnvironment: false,
  includeUnsetProject: false, includeUntagged: false, notesQuery: '', connectedAfter: '',
  connectedBefore: '', minConnections: null, maxConnections: null,
}

const searchTextCache = new WeakMap<Session, Map<string, string>>()

export function sessionAssetSearchText(session: Session, folderName = '') {
	const cachedByFolder = searchTextCache.get(session)
	const cached = cachedByFolder?.get(folderName)
	if (cached !== undefined) return cached
	const text = [session.name, session.host, session.username, folderName, session.environment?.name ?? '',
    session.project?.name ?? '', session.project?.code ?? '', ...(session.tags ?? []).map((tag) => tag.name)]
    .join('\n').toLocaleLowerCase()
	const nextCache = cachedByFolder ?? new Map<string, string>()
	nextCache.set(folderName, text)
	if (!cachedByFolder) searchTextCache.set(session, nextCache)
	return text
}

export function matchesSessionAsset(session: Session, folderName: string, filters: SessionAssetFilters) {
  const query = filters.query.trim().toLocaleLowerCase()
  if (query && !sessionAssetSearchText(session, folderName).includes(query)) return false
  if (!matchesNullableDimension(session.environmentId, filters.environmentIds, filters.includeUnsetEnvironment)) return false
  if (!matchesNullableDimension(session.projectId, filters.projectIds, filters.includeUnsetProject)) return false
  if (!matchesTags(session, filters.tagIds, filters.includeUntagged)) return false
  if (filters.notesQuery.trim() && !(session.notes ?? '').toLocaleLowerCase().includes(filters.notesQuery.trim().toLocaleLowerCase())) return false
  const connectionCount = session.connectionCount ?? 0
  if (filters.minConnections !== null && connectionCount < filters.minConnections) return false
  if (filters.maxConnections !== null && connectionCount > filters.maxConnections) return false
  if (!matchesConnectionDate(session.lastConnectedAt, filters.connectedAfter, filters.connectedBefore)) return false
  return true
}

export function filterSessionAssets(sessions: Session[], folders: Folder[], filters: SessionAssetFilters) {
  const folderNames = new Map(folders.map((folder) => [folder.id, folder.name]))
  return sessions.filter((session) => matchesSessionAsset(session, folderNames.get(session.folderId ?? '') ?? '', filters))
}

function matchesNullableDimension(value: string | undefined, selected: string[], includeUnset: boolean) {
  if (selected.length === 0 && !includeUnset) return true
  return (value !== undefined && selected.includes(value)) || (value === undefined && includeUnset)
}

function matchesTags(session: Session, selected: string[], includeUntagged: boolean) {
  const tags = session.tags ?? []
  if (selected.length === 0 && !includeUntagged) return true
  return tags.some((tag) => selected.includes(tag.id)) || (tags.length === 0 && includeUntagged)
}

function matchesConnectionDate(value: string | undefined, after: string, before: string) {
  if (!after && !before) return true
  if (!value) return false
  const timestamp = new Date(value).getTime()
  if (after && timestamp < new Date(after).getTime()) return false
  if (before && timestamp > new Date(before).getTime()) return false
  return true
}

export function activeSessionAssetFilterCount(filters: SessionAssetFilters) {
	return Number(Boolean(filters.query.trim())) + filters.environmentIds.length + filters.projectIds.length +
		filters.tagIds.length + Number(filters.includeUnsetEnvironment) + Number(filters.includeUnsetProject) +
		Number(filters.includeUntagged) + Number(Boolean(filters.notesQuery.trim())) + Number(Boolean(filters.connectedAfter)) +
		Number(Boolean(filters.connectedBefore)) + Number(filters.minConnections !== null) + Number(filters.maxConnections !== null)
}
