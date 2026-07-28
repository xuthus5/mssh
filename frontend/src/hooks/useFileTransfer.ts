import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { logger } from '@/lib/logger'
import { cancelTransfer as cancelTransferAction, startDownload, startUpload } from '@/lib/transferActions'
import { FileService } from '@/lib/wails'
import { useAppStore } from '@/store/appStore'
import type { FileEntry } from '../../bindings/github.com/xuthus5/mssh/internal/ssh/models'
import { t } from '@/i18n'
import {
  emitFileCatalogChanged,
  fileMutationScopesConflict,
  isFileMutationBlocked,
  joinRemotePath,
  normalizeRemotePath,
  parentRemotePath,
  runFileMutation,
  useFileMutationState,
  type FileCatalogChange,
  type FileMutationScope,
} from '@/lib/fileMutationCoordinator'
import { isOperationBusyError, OperationBusyError } from '@/lib/operationBusyError'
import { useFileCatalogSync } from '@/hooks/useFileCatalogSync'
import { uploadFileBatch } from '@/hooks/fileTransferBatch'


export type { TransferJob } from '@/store/appStore'

export interface FileInfo {
  name: string
  path: string
  size: number
  modified: string
  isDir: boolean
}

function mapFileEntry(file: FileEntry): FileInfo {
  return {
    name: file.name,
    path: file.path,
    size: file.size,
    modified: file.mod_time,
    isDir: file.is_dir,
  }
}

async function loadRemoteDirectory(sessionId: number, path: string): Promise<FileInfo[]> {
  return (await FileService.ListDir(sessionId, path) ?? []).map(mapFileEntry)
}

function useFileLifecycle(sessionId: number) {
  const lifecycle = useRef(0)
  const activeSession = useRef(sessionId)
  activeSession.current = sessionId
  useEffect(() => () => { lifecycle.current++ }, [])
  return useCallback(() => {
    const token = lifecycle.current
    return () => lifecycle.current === token && activeSession.current === sessionId
  }, [sessionId])
}

function useFileListing(sessionId: number, captureLifecycle: () => () => boolean) {
  const [files, setFiles] = useState<FileInfo[]>([])
  const [currentPath, setCurrentPath] = useState('/')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestID = useRef(0)
  useEffect(() => {
    requestID.current++
    setFiles([])
    setCurrentPath('/')
    setLoading(false)
    setError('')
  }, [sessionId])
  const listFiles = useCallback(async (path: string, options?: { silent?: boolean }) => {
    const isActive = captureLifecycle()
    if (!isActive()) return
    const normalizedPath = normalizeRemotePath(path)
    setLoading(true)
    if (!options?.silent) setError('')
    const currentRequest = ++requestID.current
    try {
      const result = await loadRemoteDirectory(sessionId, normalizedPath)
      if (!isActive() || currentRequest !== requestID.current) return
      setFiles(result)
      setCurrentPath(normalizedPath)
      if (options?.silent) setError('')
    } catch (listError) {
      logger.error('listFiles error', listError)
      if (isActive() && currentRequest === requestID.current) {
        const message = listError instanceof Error ? listError.message : String(listError)
        // Post-mutation reloads stay silent so successful delete/rename/mkdir is not rebranded.
        if (!options?.silent) {
          setError(message)
        }
      }
    } finally {
      if (isActive() && currentRequest === requestID.current) setLoading(false)
    }
  }, [captureLifecycle, sessionId])
  const navigateTo = useCallback((path: string) => { void listFiles(path) }, [listFiles])
  const navigateUp = useCallback(() => {
    void listFiles(parentRemotePath(currentPath))
  }, [currentPath, listFiles])
  return { files, setFiles, currentPath, loading, error, listFiles, navigateTo, navigateUp }
}

interface TransferCommandOptions {
  sessionId: number
  sessionName: string
  captureLifecycle: () => () => boolean
}

function useTransferCommands({ sessionId, sessionName, captureLifecycle }: TransferCommandOptions) {
  const upload = useCallback(async (localPath: string, remotePath: string) => {
    try {
      if (!captureLifecycle()()) throw new Error(t('会话已切换'))
      if (isFileMutationBlocked({ sessionID: sessionId, directoryPath: remotePath })) {
        throw new OperationBusyError(t('文件操作正在进行'))
      }
      const fileName = localPath.split(/[\\/]/).pop() ?? localPath
      const targetPath = `${remotePath.replace(/\/$/, '')}/${fileName}`
      await startUpload({ sessionId, sessionName, sourcePath: localPath, targetPath })
    } catch (error) {
      if (!isOperationBusyError(error)) logger.error('upload error', error)
      // File panel / caller owns transfer start failures.
      throw error
    }
  }, [captureLifecycle, sessionId, sessionName])
  const uploadMany = useCallback(async (localPaths: string[], remotePath: string) => {
    await uploadFileBatch(localPaths, remotePath, upload)
  }, [upload])
  const download = useCallback(async (remotePath: string, localPath: string) => {
    try {
      if (!captureLifecycle()()) throw new Error(t('会话已切换'))
      if (isFileMutationBlocked(mutationScope(sessionId, remotePath))) {
        throw new OperationBusyError(t('文件操作正在进行'))
      }
      await startDownload({ sessionId, sessionName, sourcePath: remotePath, targetPath: localPath })
    } catch (error) {
      if (!isOperationBusyError(error)) logger.error('download error', error)
      // File panel / caller owns transfer start failures.
      throw error
    }
  }, [captureLifecycle, sessionId, sessionName])
  return { upload, uploadMany, download }
}

interface FileMutationOptions {
  sessionId: number
  currentPath: string
  listFiles: (path: string, options?: { silent?: boolean }) => Promise<void>
  setFiles: Dispatch<SetStateAction<FileInfo[]>>
  captureLifecycle: () => () => boolean
  source: symbol
  applyCatalogChange: (change: FileCatalogChange) => void
}

function mutationScope(sessionId: number, path: string, isDir = false): FileMutationScope {
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

function useFileMutations(options: FileMutationOptions) {
  const deleteFile = useCallback((path: string, isDir = false) => executeDelete(options, path, isDir), [options])
  const renameFile = useCallback((oldPath: string, newName: string, isDir = false) => (
    executeRename(options, { oldPath, newName, isDir })
  ), [options])
  const makeDir = useCallback((name: string) => executeMkdir(options, name), [options])
  return { deleteFile, renameFile, makeDir }
}

function useCancelTransfer() {
  return useCallback(async (jobId: string) => {
    try {
      await cancelTransferAction(jobId)
    } catch (error) {
      logger.error('cancelTransfer error', error)
      // TransferCenter owns cancel failures via Sheet banner.
      throw error
    }
  }, [])
}

export function useFileTransfer(sessionId: number) {
  const transfers = useAppStore((state) => state.transfers)
  const sessionName = useAppStore((state) => state.tabs
    .find((tab) => tab.type === 'terminal' && tab.sessionId === sessionId)?.title ?? t('会话 #${}', sessionId))
  const captureLifecycle = useFileLifecycle(sessionId)
  const listing = useFileListing(sessionId, captureLifecycle)
  const catalog = useFileCatalogSync(sessionId, listing.currentPath, listing.listFiles)
  const commands = useTransferCommands({ sessionId, sessionName, captureLifecycle })
  const mutationOptions = {
    sessionId, currentPath: listing.currentPath, listFiles: listing.listFiles,
    setFiles: listing.setFiles, captureLifecycle, ...catalog,
  }
  const mutations = useFileMutations(mutationOptions)
  const activeLeases = useFileMutationState((state) => state.activeLeases)
  const directoryMutationBusy = activeLeases.some((active) => fileMutationScopesConflict(active, {
    sessionID: sessionId, directoryPath: listing.currentPath,
  }))
  const isMutationBusy = useCallback((path: string, isDir = false) => activeLeases.some((active) => (
    fileMutationScopesConflict(active, mutationScope(sessionId, path, isDir))
  )), [activeLeases, sessionId])
  const cancelTransfer = useCancelTransfer()
  const loadDirectory = useCallback(async (path: string) => {
    const isActive = captureLifecycle()
    const result = await loadRemoteDirectory(sessionId, normalizeRemotePath(path))
    return isActive() ? result : []
  }, [captureLifecycle, sessionId])
  return {
    files: listing.files, currentPath: listing.currentPath, transfers, loading: listing.loading, error: listing.error,
    listFiles: listing.listFiles, navigateTo: listing.navigateTo, navigateUp: listing.navigateUp,
    loadDirectory, catalogRevision: catalog.catalogRevision, externalCatalogRevision: catalog.externalCatalogRevision,
    directoryMutationBusy, isMutationBusy,
    ...commands, ...mutations, cancelTransfer,
  }
}
