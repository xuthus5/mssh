import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { logger } from '@/lib/logger'
import { FileService } from '@/lib/wails'
import {
  emitFileCatalogChanged,
  joinRemotePath,
  normalizeRemotePath,
  parentRemotePath,
  runFileMutation,
  type FileCatalogChange,
  type FileMutationScope,
} from '@/lib/fileMutationCoordinator'
import { isOperationBusyError } from '@/lib/operationBusyError'
import type { FileInfo } from '@/hooks/useFileTransfer'

export interface FileMutationOptions {
  sessionId: number
  currentPath: string
  listFiles: (path: string, options?: { silent?: boolean }) => Promise<void>
  setFiles: Dispatch<SetStateAction<FileInfo[]>>
  captureLifecycle: () => () => boolean
  source: symbol
  applyCatalogChange: (change: FileCatalogChange) => void
}

export function mutationScope(sessionId: number, path: string, isDir = false): FileMutationScope {
  const normalizedPath = normalizeRemotePath(path)
  return {
    sessionID: sessionId,
    directoryPath: parentRemotePath(normalizedPath),
    subtreePath: isDir ? normalizedPath : undefined,
  }
}

function reportFileMutationError(label: string, error: unknown) {
  if (!isOperationBusyError(error)) logger.error(label, error)
}

async function executeDelete(options: FileMutationOptions, path: string, isDir: boolean) {
  const normalizedPath = normalizeRemotePath(path)
  const change: FileCatalogChange = {
    sessionID: options.sessionId, source: options.source,
    directories: [parentRemotePath(normalizedPath)],
    removedSubtrees: isDir ? [normalizedPath] : undefined,
  }
  const isActive = options.captureLifecycle()
  try {
    await runFileMutation(mutationScope(options.sessionId, normalizedPath, isDir), async () => {
      await FileService.Delete(options.sessionId, normalizedPath)
      if (isActive()) {
        options.setFiles((files) => files.filter((file) => file.path !== normalizedPath))
        options.applyCatalogChange(change)
      }
      emitFileCatalogChanged(change)
    })
  } catch (error) {
    reportFileMutationError('deleteFile error', error)
    throw error
  }
}

interface RenameRequest {
  oldPath: string
  newName: string
  isDir: boolean
}

async function executeRename(options: FileMutationOptions, request: RenameRequest) {
  const normalizedPath = normalizeRemotePath(request.oldPath)
  const directoryPath = parentRemotePath(normalizedPath)
  const change: FileCatalogChange = {
    sessionID: options.sessionId, source: options.source, directories: [directoryPath],
    moves: request.isDir ? [{ from: normalizedPath, to: joinRemotePath(directoryPath, request.newName) }] : undefined,
  }
  const isActive = options.captureLifecycle()
  try {
    await runFileMutation(mutationScope(options.sessionId, normalizedPath, request.isDir), async () => {
      await FileService.Rename(options.sessionId, normalizedPath, request.newName)
      if (isActive()) options.applyCatalogChange(change)
      emitFileCatalogChanged(change)
    })
  } catch (error) {
    reportFileMutationError('renameFile error', error)
    throw error
  }
}

async function executeMkdir(options: FileMutationOptions, name: string) {
  const change: FileCatalogChange = {
    sessionID: options.sessionId, source: options.source, directories: [options.currentPath],
  }
  const isActive = options.captureLifecycle()
  try {
    await runFileMutation({ sessionID: options.sessionId, directoryPath: options.currentPath }, async () => {
      await FileService.Mkdir(options.sessionId, joinRemotePath(options.currentPath, name))
      if (isActive()) options.applyCatalogChange(change)
      emitFileCatalogChanged(change)
    })
  } catch (error) {
    reportFileMutationError('makeDir error', error)
    throw error
  }
}

async function executeCreateFile(options: FileMutationOptions, name: string) {
  const change: FileCatalogChange = {
    sessionID: options.sessionId, source: options.source, directories: [options.currentPath],
  }
  const isActive = options.captureLifecycle()
  try {
    await runFileMutation({ sessionID: options.sessionId, directoryPath: options.currentPath }, async () => {
      await FileService.CreateFile(options.sessionId, joinRemotePath(options.currentPath, name))
      if (isActive()) options.applyCatalogChange(change)
      emitFileCatalogChanged(change)
    })
  } catch (error) {
    reportFileMutationError('createFile error', error)
    throw error
  }
}

export function useFileMutations(options: FileMutationOptions) {
  const deleteFile = useCallback((path: string, isDir = false) => executeDelete(options, path, isDir), [options])
  const renameFile = useCallback((oldPath: string, newName: string, isDir = false) => (
    executeRename(options, { oldPath, newName, isDir })
  ), [options])
  const makeDir = useCallback((name: string) => executeMkdir(options, name), [options])
  const createFile = useCallback((name: string) => executeCreateFile(options, name), [options])
  return { deleteFile, renameFile, makeDir, createFile }
}
