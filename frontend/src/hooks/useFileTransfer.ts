import { useState, useCallback } from 'react'
import { FileService } from '@/lib/wails'

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

export function useFileTransfer(sessionId: number) {
  const [files, setFiles] = useState<FileInfo[]>([])
  const [currentPath, setCurrentPath] = useState('/')
  const [transfers, setTransfers] = useState<TransferJob[]>([])
  const [loading, setLoading] = useState(false)

  const listFiles = useCallback(async (path: string) => {
    setLoading(true)
    try {
      console.log('[useFileTransfer] listFiles', { sessionId, path })
      const result = await FileService.ListDir(sessionId, path)
      setFiles(result!.map((f: any) => ({
        name: f.name,
        path: f.path,
        size: f.size,
        modified: f.mod_time,
        isDir: f.is_dir,
      })))
      setCurrentPath(path)
    } catch (err) {
      console.log('[useFileTransfer] listFiles error', err)
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
      console.log('[useFileTransfer] upload', { sessionId, localPath, remotePath })
      const taskId = await FileService.Upload(sessionId, localPath, remotePath)
      setTransfers((prev) => [...prev, {
        id: taskId,
        fileName: localPath.split('/').pop() ?? localPath,
        direction: 'upload',
        totalBytes: 0, transferredBytes: 0, speed: 0, startedAt: Date.now(),
      }])
    } catch (err) {
      console.log('[useFileTransfer] upload error', err)
    }
  }, [sessionId])

  const download = useCallback(async (remotePath: string, localPath: string) => {
    try {
      console.log('[useFileTransfer] download', { sessionId, remotePath, localPath })
      const taskId = await FileService.Download(sessionId, remotePath, localPath)
      setTransfers((prev) => [...prev, {
        id: taskId,
        fileName: remotePath.split('/').pop() ?? remotePath,
        direction: 'download',
        totalBytes: 0, transferredBytes: 0, speed: 0, startedAt: Date.now(),
      }])
    } catch (err) {
      console.log('[useFileTransfer] download error', err)
    }
  }, [sessionId])

  const deleteFile = useCallback(async (path: string) => {
    try {
      console.log('[useFileTransfer] deleteFile', { sessionId, path })
      await FileService.Delete(sessionId, path)
      setFiles((prev) => prev.filter((f) => f.path !== path))
      listFiles(currentPath)
    } catch (err) {
      console.log('[useFileTransfer] deleteFile error', err)
    }
  }, [sessionId, currentPath, listFiles])

  const renameFile = useCallback(async (oldPath: string, newName: string) => {
    try {
      console.log('[useFileTransfer] renameFile', { sessionId, oldPath, newName })
      await FileService.Rename(sessionId, oldPath, newName)
      listFiles(currentPath)
    } catch (err) {
      console.log('[useFileTransfer] renameFile error', err)
    }
  }, [sessionId, currentPath, listFiles])

  const makeDir = useCallback(async (name: string) => {
    try {
      console.log('[useFileTransfer] makeDir', { sessionId, name })
      await FileService.Mkdir(sessionId, `${currentPath}/${name}`.replace('//', '/'))
      listFiles(currentPath)
    } catch (err) {
      console.log('[useFileTransfer] makeDir error', err)
    }
  }, [sessionId, currentPath, listFiles])

  const cancelTransfer = useCallback(async (jobId: string) => {
    try {
      console.log('[useFileTransfer] cancelTransfer', jobId)
      await FileService.CancelTransfer(jobId)
      setTransfers((prev) => prev.filter((t) => t.id !== jobId))
    } catch (err) {
      console.log('[useFileTransfer] cancelTransfer error', err)
    }
  }, [])

  return {
    files, currentPath, transfers, loading,
    listFiles, navigateTo, navigateUp,
    upload, download, deleteFile, renameFile, makeDir, cancelTransfer,
  }
}
