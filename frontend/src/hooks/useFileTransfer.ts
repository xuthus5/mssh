import { useState, useCallback } from 'react'
import { FileService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import type { FileEntry } from '../../bindings/mssh/internal/ssh/models'

export interface FileInfo {
  name: string
  path: string
  size: number
  modified: string
  isDir: boolean
}

export interface TransferJob {
  id: string
  fileName: string
  direction: 'upload' | 'download'
  totalBytes: number
  transferredBytes: number
  speed: number
  startedAt: number
}

function mapFileEntry(f: FileEntry): FileInfo {
  return {
    name: f.name,
    path: f.path,
    size: f.size,
    modified: f.mod_time,
    isDir: f.is_dir,
  }
}

export function useFileTransfer(sessionId: number) {
  const [files, setFiles] = useState<FileInfo[]>([])
  const [currentPath, setCurrentPath] = useState('/')
  const [transfers, setTransfers] = useState<TransferJob[]>([])
  const [loading, setLoading] = useState(false)

  const listFiles = useCallback(async (path: string) => {
    setLoading(true)
    try {
      const result = await FileService.ListDir(sessionId, path)
      setFiles((result ?? []).map(mapFileEntry))
      setCurrentPath(path)
    } catch (err) {
      logger.error('listFiles error', err)
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  const navigateTo = useCallback((path: string) => { listFiles(path) }, [listFiles])
  const navigateUp = useCallback(() => {
    const parent = currentPath.split('/').slice(0, -1).join('/') || '/'
    listFiles(parent)
  }, [currentPath, listFiles])

  const upload = useCallback(async (localPath: string, remotePath: string) => {
    try {
      const taskId = await FileService.Upload(sessionId, localPath, remotePath)
      setTransfers((prev) => [...prev, {
        id: taskId,
        fileName: localPath.split('/').pop() ?? localPath,
        direction: 'upload',
        totalBytes: 0, transferredBytes: 0, speed: 0, startedAt: Date.now(),
      }])
    } catch (err) {
      logger.error('upload error', err)
    }
  }, [sessionId])

  const download = useCallback(async (remotePath: string, localPath: string) => {
    try {
      const taskId = await FileService.Download(sessionId, remotePath, localPath)
      setTransfers((prev) => [...prev, {
        id: taskId,
        fileName: remotePath.split('/').pop() ?? remotePath,
        direction: 'download',
        totalBytes: 0, transferredBytes: 0, speed: 0, startedAt: Date.now(),
      }])
    } catch (err) {
      logger.error('download error', err)
    }
  }, [sessionId])

  const deleteFile = useCallback(async (path: string) => {
    try {
      await FileService.Delete(sessionId, path)
      setFiles((prev) => prev.filter((f) => f.path !== path))
      listFiles(currentPath)
    } catch (err) {
      logger.error('deleteFile error', err)
    }
  }, [sessionId, currentPath, listFiles])

  const renameFile = useCallback(async (oldPath: string, newName: string) => {
    try {
      await FileService.Rename(sessionId, oldPath, newName)
      listFiles(currentPath)
    } catch (err) {
      logger.error('renameFile error', err)
    }
  }, [sessionId, currentPath, listFiles])

  const makeDir = useCallback(async (name: string) => {
    try {
      await FileService.Mkdir(sessionId, `${currentPath}/${name}`.replace('//', '/'))
      listFiles(currentPath)
    } catch (err) {
      logger.error('makeDir error', err)
    }
  }, [sessionId, currentPath, listFiles])

  const cancelTransfer = useCallback(async (jobId: string) => {
    try {
      await FileService.CancelTransfer(jobId)
      setTransfers((prev) => prev.filter((t) => t.id !== jobId))
    } catch (err) {
      logger.error('cancelTransfer error', err)
    }
  }, [])

  return {
    files, currentPath, transfers, loading,
    listFiles, navigateTo, navigateUp,
    upload, download, deleteFile, renameFile, makeDir, cancelTransfer,
  }
}
