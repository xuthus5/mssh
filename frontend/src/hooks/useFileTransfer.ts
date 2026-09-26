import { useCallback, useEffect, useRef, useState } from 'react'
import { logger } from '@/lib/logger'
import { cancelTransfer as cancelTransferAction, startDownload, startUpload } from '@/lib/transferActions'
import { FileService } from '@/lib/wails'
import { useAppStore, type TransferJob } from '@/store/appStore'
import type { FileEntry } from '../../bindings/github.com/xuthus5/mssh/internal/ssh/models'
import { t } from '@/i18n'
import {
  fileMutationScopesConflict,
  isFileMutationBlocked,
  normalizeRemotePath,
  parentRemotePath,
  useFileMutationState,
  type FileCatalogChange,
} from '@/lib/fileMutationCoordinator'
import { isOperationBusyError, OperationBusyError } from '@/lib/operationBusyError'
import { useFileCatalogSync } from '@/hooks/useFileCatalogSync'
import { uploadFileBatch } from '@/hooks/fileTransferBatch'
import { mutationScope, useFileMutations } from '@/hooks/fileTransferMutations'


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

/**
 * Uploads run as background jobs, so the directory they landed in only refreshes
 * when the job reports completion. The catalog change reloads the visible directory
 * silently and invalidates it for panels that show it later.
 */
function useCompletedUploadRefresh(options: {
  transfers: TransferJob[]
  sessionId: number
  source: symbol
  applyCatalogChange: (change: FileCatalogChange) => void
}) {
  const refreshed = useRef(new Set<string>())
  const { transfers, sessionId, source, applyCatalogChange } = options
  useEffect(() => {
    const completed = transfers.filter((job) => job.sessionId === sessionId && job.direction === 'upload'
      && job.status === 'completed' && !refreshed.current.has(job.id))
    if (completed.length === 0) return
    for (const job of completed) refreshed.current.add(job.id)
    applyCatalogChange({
      sessionID: sessionId,
      source,
      directories: [...new Set(completed.map((job) => parentRemotePath(job.targetPath)))],
    })
  }, [applyCatalogChange, sessionId, source, transfers])
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
  useCompletedUploadRefresh({ transfers, sessionId, source: catalog.source, applyCatalogChange: catalog.applyCatalogChange })
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
