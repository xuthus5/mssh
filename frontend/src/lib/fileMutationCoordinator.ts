import { create } from 'zustand'
import { t } from '@/i18n'
import { OperationBusyError } from '@/lib/operationBusyError'

export interface FileMutationScope {
  sessionID: number
  directoryPath: string
  subtreePath?: string
}

export interface FileCatalogMove {
  from: string
  to: string
}

export interface FileCatalogChange {
  sessionID: number
  source: symbol
  directories: string[]
  removedSubtrees?: string[]
  moves?: FileCatalogMove[]
}

export interface ActiveFileMutation extends FileMutationScope {
  id: symbol
}

interface FileMutationState {
  activeLeases: readonly ActiveFileMutation[]
}

const fileCatalogChangedEvent = 'mssh:file-catalog-changed'
const activeLeases: ActiveFileMutation[] = []

export const useFileMutationState = create<FileMutationState>(() => ({ activeLeases: [] }))

export function normalizeRemotePath(path: string): string {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.length === 0 ? '/' : `/${parts.join('/')}`
}

export function parentRemotePath(path: string): string {
  const normalized = normalizeRemotePath(path)
  if (normalized === '/') return '/'
  return normalized.slice(0, normalized.lastIndexOf('/')) || '/'
}

export function joinRemotePath(directory: string, name: string): string {
  return normalizeRemotePath(`${directory}/${name}`)
}

export function isRemotePathWithin(path: string, root: string): boolean {
  const normalizedPath = normalizeRemotePath(path)
  const normalizedRoot = normalizeRemotePath(root)
  return normalizedRoot === '/' || normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)
}

function normalizeScope(scope: FileMutationScope): FileMutationScope {
  return {
    sessionID: scope.sessionID,
    directoryPath: normalizeRemotePath(scope.directoryPath),
    subtreePath: scope.subtreePath ? normalizeRemotePath(scope.subtreePath) : undefined,
  }
}

export function fileMutationScopesConflict(first: FileMutationScope, second: FileMutationScope): boolean {
  if (first.sessionID !== second.sessionID) return false
  if (first.directoryPath === second.directoryPath) return true
  if (first.subtreePath && isRemotePathWithin(second.directoryPath, first.subtreePath)) return true
  if (second.subtreePath && isRemotePathWithin(first.directoryPath, second.subtreePath)) return true
  if (!first.subtreePath || !second.subtreePath) return false
  return isRemotePathWithin(first.subtreePath, second.subtreePath)
    || isRemotePathWithin(second.subtreePath, first.subtreePath)
}

function publishMutationState() {
  useFileMutationState.setState({ activeLeases: [...activeLeases] })
}

export function isFileMutationBlocked(scope: FileMutationScope): boolean {
  const normalized = normalizeScope(scope)
  return activeLeases.some((active) => fileMutationScopesConflict(active, normalized))
}

export async function runFileMutation<T>(scope: FileMutationScope, operation: () => Promise<T>): Promise<T> {
  const normalized = normalizeScope(scope)
  if (activeLeases.some((active) => fileMutationScopesConflict(active, normalized))) {
    throw new OperationBusyError(t('文件操作正在进行'))
  }
  const lease: ActiveFileMutation = { ...normalized, id: Symbol('file-mutation') }
  activeLeases.push(lease)
  publishMutationState()
  try {
    return await operation()
  } finally {
    const index = activeLeases.findIndex((active) => active.id === lease.id)
    if (index >= 0) activeLeases.splice(index, 1)
    publishMutationState()
  }
}

function normalizeCatalogChange(change: FileCatalogChange): FileCatalogChange {
  return {
    ...change,
    directories: [...new Set(change.directories.map(normalizeRemotePath))],
    removedSubtrees: change.removedSubtrees?.map(normalizeRemotePath),
    moves: change.moves?.map((move) => ({
      from: normalizeRemotePath(move.from),
      to: normalizeRemotePath(move.to),
    })),
  }
}

export function emitFileCatalogChanged(change: FileCatalogChange) {
  const detail = normalizeCatalogChange(change)
  window.dispatchEvent(new CustomEvent<FileCatalogChange>(fileCatalogChangedEvent, { detail }))
}

export function onFileCatalogChanged(
  sessionID: number,
  source: symbol,
  handler: (change: FileCatalogChange) => void,
) {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<FileCatalogChange>).detail
    if (detail?.sessionID === sessionID && detail.source !== source) handler(detail)
  }
  window.addEventListener(fileCatalogChangedEvent, listener)
  return () => window.removeEventListener(fileCatalogChangedEvent, listener)
}

export function resetFileMutationCoordinator() {
  activeLeases.splice(0, activeLeases.length)
  publishMutationState()
}
