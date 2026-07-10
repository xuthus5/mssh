import { useState, useCallback } from 'react'
import { getWails } from '@/lib/wails'

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
      const wails = getWails()
      const result = await wails.FileService.ListDir(sessionId, path)
      setFiles(result.map((f) => ({
        name: f.name,
        path: f.path,
        size: f.size,
        modified: f.mod_time,
        isDir: f.is_dir,
      })))
      setCurrentPath(path)
    } catch (err) {
      console.error('[FileService.ListDir]', err)
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
      const wails = getWails()
      const taskId = await wails.FileService.Upload(sessionId, localPath, remotePath)
      setTransfers((prev) => [...prev, {
        id: taskId,
        fileName: localPath.split('/').pop() ?? localPath,
        direction: 'upload',
        totalBytes: 0, transferredBytes: 0, speed: 0, startedAt: Date.now(),
      }])
    } catch (err) {
      console.error('[FileService.Upload]', err)
    }
  }, [sessionId])

  const download = useCallback(async (remotePath: string, localPath: string) => {
    try {
      const wails = getWails()
      const taskId = await wails.FileService.Download(sessionId, remotePath, localPath)
      setTransfers((prev) => [...prev, {
        id: taskId,
        fileName: remotePath.split('/').pop() ?? remotePath,
        direction: 'download',
        totalBytes: 0, transferredBytes: 0, speed: 0, startedAt: Date.now(),
      }])
    } catch (err) {
      console.error('[FileService.Download]', err)
    }
  }, [sessionId])

  const deleteFile = useCallback(async (path: string) => {
    try {
      const wails = getWails()
      await wails.FileService.Delete(sessionId, path)
      setFiles((prev) => prev.filter((f) => f.path !== path))
      listFiles(currentPath)
    } catch (err) {
      console.error('[FileService.Delete]', err)
    }
  }, [sessionId, currentPath, listFiles])

  const renameFile = useCallback(async (oldPath: string, newName: string) => {
    try {
      const wails = getWails()
      await wails.FileService.Rename(sessionId, oldPath, newName)
      listFiles(currentPath)
    } catch (err) {
      console.error('[FileService.Rename]', err)
    }
  }, [sessionId, currentPath, listFiles])

  const makeDir = useCallback(async (name: string) => {
    try {
      const wails = getWails()
      await wails.FileService.Mkdir(sessionId, `${currentPath}/${name}`.replace('//', '/'))
      listFiles(currentPath)
    } catch (err) {
      console.error('[FileService.Mkdir]', err)
    }
  }, [sessionId, currentPath, listFiles])

  const cancelTransfer = useCallback(async (jobId: string) => {
    try {
      const wails = getWails()
      await wails.FileService.CancelTransfer(jobId)
      setTransfers((prev) => prev.filter((t) => t.id !== jobId))
    } catch (err) {
      console.error('[FileService.CancelTransfer]', err)
    }
  }, [])

  return {
    files, currentPath, transfers, loading,
    listFiles, navigateTo, navigateUp,
    upload, download, deleteFile, renameFile, makeDir, cancelTransfer,
  }
}
