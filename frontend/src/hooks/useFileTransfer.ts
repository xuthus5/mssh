import { useState, useCallback } from 'react'

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

export function useFileTransfer() {
  const [files, setFiles] = useState<FileInfo[]>([])
  const [currentPath, setCurrentPath] = useState('/')
  const [transfers, setTransfers] = useState<TransferJob[]>([])
  const [loading, setLoading] = useState(false)

  const listFiles = useCallback(async (path: string) => {
    setLoading(true)
    try {
      console.debug('[Wails:FileService.ListFiles]', path)
      // const result = await Wails.FileService.ListFiles(path)
      // setFiles(result)
      setCurrentPath(path)
    } finally {
      setLoading(false)
    }
  }, [])

  const navigateTo = useCallback(
    (path: string) => {
      listFiles(path)
    },
    [listFiles],
  )

  const navigateUp = useCallback(() => {
    const parent = currentPath.split('/').slice(0, -1).join('/') || '/'
    listFiles(parent)
  }, [currentPath, listFiles])

  const upload = useCallback(async (localPath: string, remotePath: string) => {
    console.debug('[Wails:FileService.Upload]', localPath, remotePath)
    const jobId = `upload-${Date.now()}`
    setTransfers((prev) => [
      ...prev,
      {
        id: jobId,
        fileName: localPath.split('/').pop() ?? localPath,
        direction: 'upload',
        totalBytes: 0,
        transferredBytes: 0,
        speed: 0,
        startedAt: Date.now(),
      },
    ])
  }, [])

  const download = useCallback(
    async (remotePath: string, localPath: string) => {
      console.debug('[Wails:FileService.Download]', remotePath, localPath)
      const jobId = `download-${Date.now()}`
      setTransfers((prev) => [
        ...prev,
        {
          id: jobId,
          fileName: remotePath.split('/').pop() ?? remotePath,
          direction: 'download',
          totalBytes: 0,
          transferredBytes: 0,
          speed: 0,
          startedAt: Date.now(),
        },
      ])
    },
    [],
  )

  const deleteFile = useCallback(
    async (path: string) => {
      console.debug('[Wails:FileService.Delete]', path)
      // await Wails.FileService.Delete(path)
      setFiles((prev) => prev.filter((f) => f.path !== path))
      listFiles(currentPath)
    },
    [currentPath, listFiles],
  )

  const renameFile = useCallback(
    async (oldPath: string, newName: string) => {
      console.debug('[Wails:FileService.Rename]', oldPath, newName)
      // await Wails.FileService.Rename(oldPath, newName)
      listFiles(currentPath)
    },
    [currentPath, listFiles],
  )

  const makeDir = useCallback(
    async (name: string) => {
      console.debug('[Wails:FileService.MakeDir]', currentPath, name)
      // await Wails.FileService.MakeDir(currentPath, name)
      listFiles(currentPath)
    },
    [currentPath, listFiles],
  )

  const cancelTransfer = useCallback((jobId: string) => {
    console.debug('[Wails:FileService.CancelTransfer]', jobId)
    // await Wails.FileService.CancelTransfer(jobId)
    setTransfers((prev) => prev.filter((t) => t.id !== jobId))
  }, [])

  return {
    files,
    currentPath,
    transfers,
    loading,
    listFiles,
    navigateTo,
    navigateUp,
    upload,
    download,
    deleteFile,
    renameFile,
    makeDir,
    cancelTransfer,
  }
}
