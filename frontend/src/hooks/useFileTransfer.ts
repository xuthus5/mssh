import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { toast } from '@/components/ui/toast'
import { logger } from '@/lib/logger'
import { cancelTransfer as cancelTransferAction, startDownload, startUpload } from '@/lib/transferActions'
import { FileService } from '@/lib/wails'
import { useAppStore } from '@/store/appStore'
import type { FileEntry } from '../../bindings/github.com/xuthus5/mssh/internal/ssh/models'

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

function useFileListing(sessionId: number) {
  const [files, setFiles] = useState<FileInfo[]>([])
  const [currentPath, setCurrentPath] = useState('/')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestID = useRef(0)
  const listFiles = useCallback(async (path: string) => {
    setLoading(true)
    setError('')
    const currentRequest = ++requestID.current
    try {
      const result = await loadRemoteDirectory(sessionId, path)
      if (currentRequest !== requestID.current) return
      setFiles(result)
      setCurrentPath(path)
    } catch (listError) {
      logger.error('listFiles error', listError)
      if (currentRequest === requestID.current) {
        setError(listError instanceof Error ? listError.message : String(listError))
      }
    } finally {
      if (currentRequest === requestID.current) setLoading(false)
    }
  }, [sessionId])
  const navigateTo = useCallback((path: string) => { void listFiles(path) }, [listFiles])
  const navigateUp = useCallback(() => {
    const parent = currentPath.split('/').slice(0, -1).join('/') || '/'
    void listFiles(parent)
  }, [currentPath, listFiles])
  return { files, setFiles, currentPath, loading, error, listFiles, navigateTo, navigateUp }
}

interface TransferCommandOptions {
  sessionId: number
  sessionName: string
}

function useTransferCommands({ sessionId, sessionName }: TransferCommandOptions) {
  const upload = useCallback(async (localPath: string, remotePath: string) => {
    try {
      const fileName = localPath.split(/[\\/]/).pop() ?? localPath
      const targetPath = `${remotePath.replace(/\/$/, '')}/${fileName}`
      await startUpload({ sessionId, sessionName, sourcePath: localPath, targetPath })
    } catch (error) {
      logger.error('upload error', error)
      toast(`上传失败: ${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }, [sessionId, sessionName])
  const uploadMany = useCallback(async (localPaths: string[], remotePath: string) => {
    await Promise.all(localPaths.map((localPath) => upload(localPath, remotePath)))
  }, [upload])
  const download = useCallback(async (remotePath: string, localPath: string) => {
    try {
      await startDownload({ sessionId, sessionName, sourcePath: remotePath, targetPath: localPath })
    } catch (error) {
      logger.error('download error', error)
      toast(`下载失败: ${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }, [sessionId, sessionName])
  return { upload, uploadMany, download }
}

interface FileMutationOptions {
  sessionId: number
  currentPath: string
  listFiles: (path: string) => Promise<void>
  setFiles: Dispatch<SetStateAction<FileInfo[]>>
}

function useFileMutations({ sessionId, currentPath, listFiles, setFiles }: FileMutationOptions) {
  const deleteFile = useCallback(async (path: string) => {
    try {
      await FileService.Delete(sessionId, path)
      setFiles((files) => files.filter((file) => file.path !== path))
      void listFiles(currentPath)
    } catch (error) {
      logger.error('deleteFile error', error)
    }
  }, [sessionId, currentPath, listFiles, setFiles])
  const renameFile = useCallback(async (oldPath: string, newName: string) => {
    try {
      await FileService.Rename(sessionId, oldPath, newName)
      void listFiles(currentPath)
    } catch (error) {
      logger.error('renameFile error', error)
    }
  }, [sessionId, currentPath, listFiles])
  const makeDir = useCallback(async (name: string) => {
    try {
      await FileService.Mkdir(sessionId, `${currentPath}/${name}`.replace('//', '/'))
      void listFiles(currentPath)
    } catch (error) {
      logger.error('makeDir error', error)
    }
  }, [sessionId, currentPath, listFiles])
  return { deleteFile, renameFile, makeDir }
}

function useCancelTransfer() {
  return useCallback(async (jobId: string) => {
    try {
      await cancelTransferAction(jobId)
    } catch (error) {
      logger.error('cancelTransfer error', error)
    }
  }, [])
}

export function useFileTransfer(sessionId: number) {
  const transfers = useAppStore((state) => state.transfers)
  const sessionName = useAppStore((state) => state.tabs
    .find((tab) => tab.type === 'terminal' && tab.sessionId === sessionId)?.title ?? `会话 #${sessionId}`)
  const listing = useFileListing(sessionId)
  const commands = useTransferCommands({ sessionId, sessionName })
  const mutations = useFileMutations({
    sessionId, currentPath: listing.currentPath, listFiles: listing.listFiles, setFiles: listing.setFiles,
  })
  const cancelTransfer = useCancelTransfer()
  const loadDirectory = useCallback((path: string) => loadRemoteDirectory(sessionId, path), [sessionId])
  return {
    files: listing.files, currentPath: listing.currentPath, transfers, loading: listing.loading, error: listing.error,
    listFiles: listing.listFiles, navigateTo: listing.navigateTo, navigateUp: listing.navigateUp,
    loadDirectory,
    ...commands, ...mutations, cancelTransfer,
  }
}
