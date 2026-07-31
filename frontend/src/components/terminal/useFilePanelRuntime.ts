import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { Dialogs, Events } from '@wailsio/runtime'
import { toast } from '@/components/ui/toast'
import { MANUAL_TERMINAL_DIRECTORY_REPORT, waitForTerminalWorkingDirectory } from '@/hooks/terminalDirectoryRuntime'
import { useFileTransfer } from '@/hooks/useFileTransfer'
import { t } from '@/i18n'
import { FileService, TerminalService } from '@/lib/wails'
import { useSFTPSettingsStore } from '@/store/sftpSettingsStore'
import { useTerminalDirectoryStore } from '@/store/terminalDirectoryStore'

type FileTransfer = ReturnType<typeof useFileTransfer>
type SetError = Dispatch<SetStateAction<string>>
type TransferDialogAction = 'upload' | 'download'
const maxDroppedUploadFiles = 32

function usePanelLifecycle(identity: string) {
  const lifecycle = useRef(0)
  const generation = useRef(0)
  const previousIdentity = useRef(identity)
  if (previousIdentity.current !== identity) {
    previousIdentity.current = identity
    generation.current++
  }
  useEffect(() => {
    const token = ++lifecycle.current
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [])
  return useCallback(() => {
    const lifecycleToken = lifecycle.current
    const generationToken = generation.current
    return () => lifecycle.current === lifecycleToken && generation.current === generationToken
  }, [])
}

function useTransferDialogRuntime() {
  const requestID = useRef(0)
  const active = useRef(false)
  const mounted = useRef(false)
  const [pending, setPending] = useState<TransferDialogAction | null>(null)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      requestID.current++
      active.current = false
    }
  }, [])
  return { requestID, active, mounted, pending, setPending }
}

type TransferDialogRuntime = ReturnType<typeof useTransferDialogRuntime>

function beginTransferDialog(runtime: TransferDialogRuntime, action: TransferDialogAction) {
  if (runtime.active.current) return 0
  runtime.active.current = true
  const request = ++runtime.requestID.current
  runtime.setPending(action)
  return request
}

function finishTransferDialog(runtime: TransferDialogRuntime, request: number) {
  if (runtime.requestID.current !== request) return
  runtime.active.current = false
  if (runtime.mounted.current) runtime.setPending(null)
}

function useInitialFileListing(options: {
  transfer: FileTransfer
  followTerminalDirectory: boolean
  terminalDirectory?: string
  loadedInitialPath: MutableRefObject<boolean>
}) {
  useEffect(() => {
    if (!options.loadedInitialPath.current) {
      options.loadedInitialPath.current = true
      void options.transfer.listFiles(
        options.followTerminalDirectory && options.terminalDirectory ? options.terminalDirectory : '/',
      )
      return
    }
    if (options.followTerminalDirectory && options.terminalDirectory) {
      void options.transfer.listFiles(options.terminalDirectory)
    }
  }, [options.followTerminalDirectory, options.loadedInitialPath, options.terminalDirectory, options.transfer.listFiles])
}

function useCurrentDirectorySync(options: {
  terminalID: string
  followTerminalDirectory: boolean
  transfer: FileTransfer
  captureLifecycle: () => () => boolean
  syncingRef: MutableRefObject<boolean>
  syncRequestID: MutableRefObject<number>
  setSyncing: Dispatch<SetStateAction<boolean>>
  setActionError: SetError
}) {
  return useCallback(async () => {
    const { captureLifecycle, syncingRef, syncRequestID, setSyncing, setActionError, terminalID, transfer } = options
    const isActive = captureLifecycle()
    if (!isActive() || syncingRef.current) return
    const request = ++syncRequestID.current
    syncingRef.current = true
    setSyncing(true)
    setActionError('')
    const revision = useTerminalDirectoryStore.getState().revisions[terminalID] ?? 0
    try {
      await TerminalService.Write(terminalID, MANUAL_TERMINAL_DIRECTORY_REPORT)
      const path = await waitForTerminalWorkingDirectory(terminalID, revision)
      if (!isActive()) return
      if (!options.followTerminalDirectory || path === transfer.currentPath) await transfer.listFiles(path)
      if (isActive()) toast(t('已同步当前目录: ${}', path), 'success')
    } catch (error) {
      if (isActive()) setActionError(t('同步当前目录失败: ${}', error instanceof Error ? error.message : String(error)))
    } finally {
      if (syncRequestID.current !== request) return
      syncingRef.current = false
      if (isActive()) setSyncing(false)
    }
  }, [options.captureLifecycle, options.followTerminalDirectory, options.setActionError, options.setSyncing,
    options.syncingRef, options.syncRequestID, options.terminalID, options.transfer.currentPath, options.transfer.listFiles])
}

function useShellIntegrationInstall(options: {
  sessionID: number
  captureLifecycle: () => () => boolean
  installingRef: MutableRefObject<boolean>
  installRequestID: MutableRefObject<number>
  setInstalling: Dispatch<SetStateAction<boolean>>
  setActionError: SetError
}) {
  return useCallback(async () => {
    const { captureLifecycle, installingRef, installRequestID, setActionError, setInstalling, sessionID } = options
    const isActive = captureLifecycle()
    if (!isActive() || installingRef.current) return
    const request = ++installRequestID.current
    installingRef.current = true
    setInstalling(true)
    setActionError('')
    try {
      const paths = await FileService.InstallTerminalDirectoryIntegration(sessionID)
      if (!isActive()) return
      const summary = paths.length > 0 ? paths.join(', ') : t('脚本已安装')
      toast(t('已安装自动跟随脚本: ${}', summary), 'success')
    } catch (error) {
      if (isActive()) setActionError(t('安装自动跟随脚本失败: ${}', error instanceof Error ? error.message : String(error)))
    } finally {
      if (installRequestID.current !== request) return
      installingRef.current = false
      if (isActive()) setInstalling(false)
    }
  }, [options.captureLifecycle, options.installRequestID, options.installingRef, options.sessionID, options.setActionError, options.setInstalling])
}

function useDroppedFileUpload(options: {
  dropTargetID: string
  transfer: FileTransfer
  captureLifecycle: () => () => boolean
  setActionError: SetError
}) {
  const active = useRef(false)
  useEffect(() => Events.On('sftp:files-dropped', (event: { data?: { files?: string[]; details?: { id?: string } } }) => {
    const isActive = options.captureLifecycle()
    const files = [...new Set(event.data?.files ?? [])]
    if (!isActive() || files.length === 0 || event.data?.details?.id !== options.dropTargetID) return
    if (active.current) {
      options.setActionError(t('上传队列正在处理，请稍后重试'))
      return
    }
    if (files.length > maxDroppedUploadFiles) {
      options.setActionError(t('单次最多拖拽 ${} 个文件', maxDroppedUploadFiles))
      return
    }
    active.current = true
    options.setActionError('')
    void options.transfer.uploadMany(files, options.transfer.currentPath).catch((error: unknown) => {
      if (isActive()) options.setActionError(t('上传失败: ${}', error instanceof Error ? error.message : String(error)))
    }).finally(() => { active.current = false })
  }), [options.captureLifecycle, options.dropTargetID, options.setActionError,
    options.transfer.currentPath, options.transfer.uploadMany])
}

function useUploadDialog(options: {
  transfer: FileTransfer
  captureLifecycle: () => () => boolean
  dialog: TransferDialogRuntime
  setActionError: SetError
}) {
  return useCallback(async () => {
    const request = beginTransferDialog(options.dialog, 'upload')
    if (request === 0) return
    const isActive = options.captureLifecycle()
    const isCurrent = () => isActive() && options.dialog.requestID.current === request
    let phase: 'picker' | 'transfer' = 'picker'
    try {
      if (!isCurrent()) return
      options.setActionError('')
      const selected = await Dialogs.OpenFile({
        Title: t('选择要上传的文件'), CanChooseFiles: true,
        CanChooseDirectories: false, AllowsMultipleSelection: false,
      })
      const localPath = typeof selected === 'string' ? selected : selected?.[0] ?? ''
      if (!isCurrent() || !localPath) return
      phase = 'transfer'
      await options.transfer.upload(localPath, options.transfer.currentPath)
    } catch (error) {
      if (isCurrent()) {
        const message = error instanceof Error ? error.message : String(error)
        options.setActionError(t(phase === 'picker' ? '选择上传文件失败: ${}' : '上传失败: ${}', message))
      }
    } finally {
      finishTransferDialog(options.dialog, request)
    }
  }, [options.captureLifecycle, options.dialog, options.setActionError, options.transfer.currentPath, options.transfer.upload])
}

function useDownloadDialog(options: {
  transfer: FileTransfer
  captureLifecycle: () => () => boolean
  dialog: TransferDialogRuntime
  setActionError: SetError
}) {
  return useCallback(async (remotePath: string) => {
    const request = beginTransferDialog(options.dialog, 'download')
    if (request === 0) return
    const isActive = options.captureLifecycle()
    const isCurrent = () => isActive() && options.dialog.requestID.current === request
    let phase: 'picker' | 'transfer' = 'picker'
    try {
      if (!isCurrent()) return
      options.setActionError('')
      const localPath = await Dialogs.SaveFile({
        Title: t('选择下载位置'), Filename: remotePath.split('/').pop() ?? 'download', CanCreateDirectories: true,
      }) ?? ''
      if (!isCurrent() || !localPath) return
      phase = 'transfer'
      await options.transfer.download(remotePath, localPath)
    } catch (error) {
      if (isCurrent()) {
        const message = error instanceof Error ? error.message : String(error)
        options.setActionError(t(phase === 'picker' ? '选择下载位置失败: ${}' : '下载失败: ${}', message))
      }
    } finally {
      finishTransferDialog(options.dialog, request)
    }
  }, [options.captureLifecycle, options.dialog, options.setActionError, options.transfer.download])
}

export function useFilePanelRuntime(sessionID: number, terminalID: string) {
  const transfer = useFileTransfer(sessionID)
  const showHiddenFiles = useSFTPSettingsStore((state) => state.showHiddenFiles)
  const followTerminalDirectory = useSFTPSettingsStore((state) => state.followTerminalDirectory)
  const defaultView = useSFTPSettingsStore((state) => state.defaultView)
  const terminalDirectory = useTerminalDirectoryStore((state) => state.directories[terminalID])
  const loadedInitialPath = useRef(false)
  const syncingRef = useRef(false)
  const syncRequestID = useRef(0)
  const [syncingCurrentDirectory, setSyncingCurrentDirectory] = useState(false)
  const installingRef = useRef(false)
  const installRequestID = useRef(0)
  const [installingDirectoryIntegration, setInstallingDirectoryIntegration] = useState(false)
  const [actionError, setActionError] = useState('')
  const identity = `${sessionID}:${terminalID}`
  const captureLifecycle = usePanelLifecycle(identity)
  const dialog = useTransferDialogRuntime()
  useEffect(() => {
    loadedInitialPath.current = false
    syncRequestID.current++
    syncingRef.current = false
    setSyncingCurrentDirectory(false)
    installRequestID.current++
    installingRef.current = false
    setInstallingDirectoryIntegration(false)
    setActionError('')
  }, [sessionID, terminalID])
  useInitialFileListing({ transfer, followTerminalDirectory, terminalDirectory, loadedInitialPath })
  const shared = { transfer, captureLifecycle, dialog, setActionError }
  const syncCurrentDirectory = useCurrentDirectorySync({
    ...shared, terminalID, followTerminalDirectory, syncingRef, syncRequestID,
    setSyncing: setSyncingCurrentDirectory,
  })
  const installTerminalDirectoryIntegration = useShellIntegrationInstall({
    ...shared, sessionID, installingRef, installRequestID, setInstalling: setInstallingDirectoryIntegration,
  })
  const dropTargetID = `sftp-drop-zone-${terminalID}`
  useDroppedFileUpload({ ...shared, dropTargetID })
  const handleUpload = useUploadDialog(shared)
  const handleDownload = useDownloadDialog(shared)
  return {
    transfer, showHiddenFiles, defaultView, dropTargetID, actionError,
    transferActionPending: dialog.pending, syncingCurrentDirectory, syncCurrentDirectory,
    installingDirectoryIntegration, installTerminalDirectoryIntegration, handleUpload, handleDownload,
  }
}
