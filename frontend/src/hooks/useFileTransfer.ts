import { useState, useCallback, useRef } from 'react'
import { FileService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import type { FileEntry } from '../../bindings/github.com/xuthus5/mssh/internal/ssh/models'
import { useAppStore } from '@/store/appStore'
export type { TransferJob } from '@/store/appStore'
import { toast } from '@/components/ui/toast'

export interface FileInfo {
  name: string
  path: string
  size: number
  modified: string
  isDir: boolean
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestID = useRef(0)
  const transfers = useAppStore((state) => state.transfers)

  const listFiles = useCallback(async (path: string) => {
    setLoading(true)
    setError('')
    const currentRequest = ++requestID.current
    try {
      const result = await FileService.ListDir(sessionId, path)
      if (currentRequest !== requestID.current) return
      setFiles((result ?? []).map(mapFileEntry))
      setCurrentPath(path)
    } catch (err) {
      logger.error('listFiles error', err)
      if (currentRequest === requestID.current) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (currentRequest === requestID.current) setLoading(false)
    }
  }, [sessionId])

  const navigateTo = useCallback((path: string) => { listFiles(path) }, [listFiles])
  const navigateUp = useCallback(() => {
    const parent = currentPath.split('/').slice(0, -1).join('/') || '/'
    listFiles(parent)
  }, [currentPath, listFiles])

  const upload = useCallback(async (localPath: string, remotePath: string) => {
    try {
      const fileName = localPath.split(/[\\/]/).pop() ?? localPath
      const targetPath = `${remotePath.replace(/\/$/, '')}/${fileName}`
      const taskId = await FileService.Upload(sessionId, localPath, targetPath)
      useAppStore.getState().addTransfer({
        id: taskId,
        fileName,
        direction: 'upload',
        totalBytes: 0, transferredBytes: 0, speed: 0, eta: 0, status: 'queued', startedAt: Date.now(),
      })
    } catch (err) {
      logger.error('upload error', err)
      toast(`上传失败: ${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }, [sessionId])

  const download = useCallback(async (remotePath: string, localPath: string) => {
    try {
      const taskId = await FileService.Download(sessionId, remotePath, localPath)
      useAppStore.getState().addTransfer({
        id: taskId,
        fileName: remotePath.split('/').pop() ?? remotePath,
        direction: 'download',
        totalBytes: 0, transferredBytes: 0, speed: 0, eta: 0, status: 'queued', startedAt: Date.now(),
      })
    } catch (err) {
      logger.error('download error', err)
      toast(`下载失败: ${err instanceof Error ? err.message : String(err)}`, 'error')
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
    } catch (err) {
      logger.error('cancelTransfer error', err)
    }
  }, [])

  return {
    files, currentPath, transfers, loading, error,
    listFiles, navigateTo, navigateUp,
    upload, download, deleteFile, renameFile, makeDir, cancelTransfer,
  }
}
