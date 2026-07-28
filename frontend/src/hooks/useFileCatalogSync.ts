import { useCallback, useEffect, useRef, useState } from 'react'
import {
  isRemotePathWithin,
  normalizeRemotePath,
  onFileCatalogChanged,
  parentRemotePath,
  type FileCatalogChange,
} from '@/lib/fileMutationCoordinator'

type ListFiles = (path: string, options?: { silent?: boolean }) => Promise<void>

function remapCatalogPath(currentPath: string, change: FileCatalogChange): string | null {
  for (const move of change.moves ?? []) {
    if (!isRemotePathWithin(currentPath, move.from)) continue
    const suffix = currentPath === move.from ? '' : currentPath.slice(move.from.length)
    return normalizeRemotePath(`${move.to}${suffix}`)
  }
  for (const removed of change.removedSubtrees ?? []) {
    if (isRemotePathWithin(currentPath, removed)) return parentRemotePath(removed)
  }
  return change.directories.includes(currentPath) ? currentPath : null
}

function catalogChangeAffectsTree(currentPath: string, change: FileCatalogChange): boolean {
  const paths = [
    ...change.directories,
    ...(change.removedSubtrees ?? []),
    ...(change.moves ?? []).flatMap((move) => [move.from, move.to]),
  ]
  return paths.some((path) => isRemotePathWithin(path, currentPath) || isRemotePathWithin(currentPath, path))
}

export function useFileCatalogSync(sessionId: number, currentPath: string, listFiles: ListFiles) {
  const source = useRef(Symbol('file-panel')).current
  const [catalogRevision, setCatalogRevision] = useState(0)
  const [externalCatalogRevision, setExternalCatalogRevision] = useState(0)
  const applyChange = useCallback((change: FileCatalogChange, external: boolean) => {
    if (!catalogChangeAffectsTree(currentPath, change)) return
    setCatalogRevision((revision) => revision + 1)
    if (external) setExternalCatalogRevision((revision) => revision + 1)
    const nextPath = remapCatalogPath(currentPath, change)
    if (nextPath) void listFiles(nextPath, nextPath === currentPath ? { silent: true } : undefined)
  }, [currentPath, listFiles])
  const applyCatalogChange = useCallback((change: FileCatalogChange) => applyChange(change, false), [applyChange])
  useEffect(() => onFileCatalogChanged(sessionId, source, (change) => applyChange(change, true)), [applyChange, sessionId, source])
  useEffect(() => {
    setCatalogRevision(0)
    setExternalCatalogRevision(0)
  }, [sessionId])
  return { source, catalogRevision, externalCatalogRevision, applyCatalogChange }
}
