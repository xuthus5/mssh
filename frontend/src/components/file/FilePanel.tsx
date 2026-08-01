import { useState, useEffect, useRef, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import type { FileInfo } from '@/hooks/useFileTransfer'
import { ArrowUp, FolderTree, List, RefreshCw } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { FileListView } from '@/components/file/FileListView'
import { FileTreeView, filterHiddenFiles } from '@/components/file/FileTreeView'
import type { SFTPDefaultView } from '@/lib/sftpSettings'
import { useToolPanelResize } from '@/hooks/useToolPanelResize'
import { t } from '@/i18n'
import { createMkdirSubmit } from '@/components/file/filePanelMkdirRuntime'


interface Props {
  open: boolean
  onClose: () => void
  files: FileInfo[]
  currentPath: string
  loading: boolean
  error?: string
  actionError?: string
  onNavigateTo: (path: string) => void
  onNavigateUp: () => void
  onDelete: (path: string, isDir?: boolean) => void | Promise<void>
  onRename: (oldPath: string, newName: string, isDir?: boolean) => void | Promise<void>
  onMakeDir: (name: string) => void | Promise<void>
  onUpload: () => void
  onDownload: (path: string) => void
  transferActionPending: 'upload' | 'download' | null
  dropTargetId: string
  showHiddenFiles: boolean
  defaultView: SFTPDefaultView
  onLoadDirectory: (path: string) => Promise<FileInfo[]>
  onSyncCurrentDirectory: () => void
  syncingCurrentDirectory: boolean
  followsTerminalDirectory?: boolean
  catalogRevision?: number
  externalCatalogRevision?: number
  directoryMutationBusy?: boolean
  isMutationBusy?: (file: FileInfo) => boolean
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default function FilePanel(props: Props) {
  const { open, onClose, files, currentPath, loading, onNavigateTo, onNavigateUp, onDelete, onRename, onMakeDir, onUpload, onDownload, transferActionPending, dropTargetId, error, actionError = '', showHiddenFiles, defaultView, onLoadDirectory, onSyncCurrentDirectory, syncingCurrentDirectory, followsTerminalDirectory = false, catalogRevision = 0, externalCatalogRevision = 0, directoryMutationBusy = false, isMutationBusy = () => false } = props
  const state = useFilePanelState({ defaultView, currentPath, panelOpen: open, externalCatalogRevision })
  const selectedMutationBusy = state.selected ? isMutationBusy(state.selected) : false
  const panel = useToolPanelResize('files')
  const dialogs = <FileDialogs panelOpen={open} selected={state.selected} renameOpen={state.renameOpen} renameName={state.renameName} deleteOpen={state.deleteOpen}
    onRenameOpenChange={state.setRenameOpen} onRenameNameChange={state.setRenameName} onDeleteOpenChange={state.setDeleteOpen}
    onRename={onRename} onDelete={onDelete} externalBusy={selectedMutationBusy}
    onClearSelection={() => state.setSelected(null)} onMutationError={state.setMutationError} />
  return (
    <>
    {open ? <aside id={dropTargetId} data-file-drop-target style={panel.panelStyle} className="group/drop relative flex-shrink-0 flex flex-col border-l border-border bg-card file-drop-target-active:ring-2 file-drop-target-active:ring-inset file-drop-target-active:ring-primary">
      <ToolPanelResizeHandle {...panel.resizeHandleProps} />
      <div className="pointer-events-none absolute inset-3 z-40 hidden place-items-center rounded-xl border-2 border-dashed border-primary bg-background/90 text-sm font-medium text-primary shadow-sm group-[.file-drop-target-active]/drop:grid">{t('释放文件以上传到当前目录')}</div>
      <PanelHeader onClose={onClose} onSyncCurrentDirectory={onSyncCurrentDirectory} syncingCurrentDirectory={syncingCurrentDirectory} followsTerminalDirectory={followsTerminalDirectory} />
      <PathBar currentPath={currentPath} onNavigateUp={onNavigateUp} onNavigateTo={onNavigateTo} />
      <FileActions selected={state.selected} currentPath={currentPath} view={state.view} showMkdir={state.showMkdir}
        onUpload={onUpload} onDownload={onDownload} onNavigateTo={onNavigateTo} onSetView={state.setView}
        onToggleMkdir={state.toggleMkdir} onRename={state.openRename} onDelete={state.openDelete}
        mkdirPending={state.mkdirPending} transferActionPending={transferActionPending}
        directoryMutationBusy={directoryMutationBusy} selectedMutationBusy={selectedMutationBusy} />
      {error && <Alert variant="destructive" className="m-2"><AlertTitle>{t('目录加载失败')}</AlertTitle><AlertDescription>{error}<Button size="xs" variant="outline" className="ml-2" onClick={() => onNavigateTo(currentPath)}>{t('重试')}</Button></AlertDescription></Alert>}
      {(actionError || state.mutationError) ? (
        <Alert variant="destructive" className="m-2">
          <AlertDescription>{actionError || state.mutationError}</AlertDescription>
        </Alert>
      ) : null}
      {state.showMkdir && <MkdirForm name={state.mkdirName} pending={state.mkdirPending || directoryMutationBusy} onChange={state.setMkdirName} onSubmit={(event) => { void state.submitMkdir(event, onMakeDir, directoryMutationBusy) }} />}
      <FileContent view={state.view} files={files} loading={loading} currentPath={currentPath} showHiddenFiles={showHiddenFiles}
        selected={state.selected} onSelect={state.setSelected} onNavigate={onNavigateTo} onDownload={onDownload}
        onLoadDirectory={onLoadDirectory} catalogRevision={catalogRevision} isMutationBusy={isMutationBusy} />
    </aside> : null}
    {dialogs}
    </>
  )
}

function ToolPanelResizeHandle(props: ReturnType<typeof useToolPanelResize>['resizeHandleProps']) {
  return <div {...props} className="absolute inset-y-0 -left-1 z-30 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent hover:after:bg-primary/60 focus-visible:after:bg-primary active:after:bg-primary" />
}

function useFilePanelRuntime({ currentPath, panelOpen, defaultView, setMkdirName, setMkdirPending, setMutationError, setView }: {
  currentPath: string
  panelOpen: boolean
  defaultView: SFTPDefaultView
  setMkdirName: (name: string) => void
  setMkdirPending: (pending: boolean) => void
  setMutationError: (error: string) => void
  setView: (view: SFTPDefaultView) => void
}) {
  const lifecycle = useRef(0)
  const generation = useRef(0)
  const mkdirRequest = useRef(0)
  const mkdirActive = useRef(false)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [])
  useEffect(() => {
    generation.current += 1
    setMkdirPending(mkdirActive.current)
    setMutationError('')
  }, [currentPath, panelOpen, setMkdirPending, setMutationError])
  useEffect(() => setMkdirName(''), [currentPath, setMkdirName])
  useEffect(() => setView(defaultView), [defaultView, setView])
  return { lifecycle, generation, mkdirRequest, mkdirActive }
}

interface FilePanelStateOptions {
  defaultView: SFTPDefaultView
  currentPath: string
  panelOpen: boolean
  externalCatalogRevision: number
}

function useExternalCatalogReset(options: {
  revision: number
  setSelected: (file: FileInfo | null) => void
  setRenameOpen: (open: boolean) => void
  setDeleteOpen: (open: boolean) => void
}) {
  const { revision, setSelected, setRenameOpen, setDeleteOpen } = options
  useEffect(() => {
    setSelected(null)
    setRenameOpen(false)
    setDeleteOpen(false)
  }, [revision, setDeleteOpen, setRenameOpen, setSelected])
}

function useFilePanelState(options: FilePanelStateOptions) {
  const { defaultView, currentPath, panelOpen, externalCatalogRevision } = options
  const [mkdirName, setMkdirName] = useState('')
  const [showMkdir, setShowMkdir] = useState(false)
  const [selected, setSelected] = useState<FileInfo | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameName, setRenameName] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [view, setView] = useState<SFTPDefaultView>(defaultView)
  const [mutationError, setMutationError] = useState('')
  const [mkdirPending, setMkdirPending] = useState(false)
  const runtime = useFilePanelRuntime({ currentPath, panelOpen, defaultView, setMkdirName, setMkdirPending, setMutationError, setView })
  useExternalCatalogReset({
    revision: externalCatalogRevision,
    setSelected,
    setRenameOpen,
    setDeleteOpen,
  })
  const submitMkdir = createMkdirSubmit({
    runtime, panelOpen, mkdirName, setMkdirName, setShowMkdir, setMkdirPending, setMutationError,
  })
  const openRename = () => { if (selected) { setRenameName(selected.name); setRenameOpen(true) } }
  const toggleMkdir = () => {
    if (runtime.mkdirActive.current) return
    runtime.generation.current++
    setShowMkdir((current) => !current)
  }
  return {
    mkdirName, setMkdirName, showMkdir, mkdirPending, toggleMkdir, submitMkdir,
    selected, setSelected, renameOpen, setRenameOpen, renameName, setRenameName, openRename,
    deleteOpen, setDeleteOpen, openDelete: () => setDeleteOpen(true), view, setView, mutationError, setMutationError,
  }
}

function MkdirForm({ name, pending, onChange, onSubmit }: { name: string; pending: boolean; onChange: (name: string) => void; onSubmit: (event: FormEvent) => void }) {
  return <form onSubmit={onSubmit} className="flex items-center gap-1 border-b border-border px-3 py-1.5"><input disabled={pending} className="h-7 flex-1 rounded border border-input bg-transparent px-2 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50" placeholder={t('文件夹名')} value={name} onChange={(event) => onChange(event.target.value)} autoFocus /><Button size="xs" type="submit" disabled={pending}>{t('确定')}</Button></form>
}

function FileContent({ view, files, loading, currentPath, showHiddenFiles, selected, onSelect, onNavigate, onDownload, onLoadDirectory, catalogRevision, isMutationBusy }: { view: SFTPDefaultView; files: FileInfo[]; loading: boolean; currentPath: string; showHiddenFiles: boolean; selected: FileInfo | null; onSelect: (file: FileInfo) => void; onNavigate: (path: string) => void; onDownload: (path: string) => void; onLoadDirectory: (path: string) => Promise<FileInfo[]>; catalogRevision: number; isMutationBusy: (file: FileInfo) => boolean }) {
  const shared = { files: filterHiddenFiles(files, showHiddenFiles), loading, selected, onSelect, onNavigate, onDownload, isMutationBusy }
  return <div className="min-h-0 flex-1 overflow-y-auto">{view === 'list' ? <FileListView {...shared} /> : <FileTreeView {...shared} currentPath={currentPath} showHiddenFiles={showHiddenFiles} onLoadDirectory={onLoadDirectory} catalogRevision={catalogRevision} />}</div>
}

function PanelHeader({ onClose, onSyncCurrentDirectory, syncingCurrentDirectory, followsTerminalDirectory }: { onClose: () => void; onSyncCurrentDirectory: () => void; syncingCurrentDirectory: boolean; followsTerminalDirectory: boolean }) {
  return <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2"><span className="text-sm font-medium">{t('文件管理')}</span><div className="flex shrink-0 items-center gap-1">{!followsTerminalDirectory ? <Button size="xs" variant="outline" title={t('同步当前终端的 Shell 工作目录（需要处于 Shell 提示符）')} disabled={syncingCurrentDirectory} onClick={onSyncCurrentDirectory}><RefreshCw className={syncingCurrentDirectory ? 'animate-spin' : undefined} data-icon="inline-start" />{syncingCurrentDirectory ? t('同步中') : t('同步当前目录')}</Button> : null}<Button size="xs" variant="ghost" onClick={onClose}>{t('关闭')}</Button></div></div>
}

function PathBar({ currentPath, onNavigateUp, onNavigateTo }: { currentPath: string; onNavigateUp: () => void; onNavigateTo: (path: string) => void }) {
  const breadcrumbs = currentPath.split('/').filter(Boolean).map((name, index, parts) => ({ name, path: `/${parts.slice(0, index + 1).join('/')}` }))
  return <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-3 py-1.5"><button type="button" aria-label={t('上级目录')} className="flex-shrink-0 rounded p-0.5 hover:bg-muted" onClick={onNavigateUp}><ArrowUp className="size-3.5" /></button>{currentPath === '/' ? <span className="text-sm text-muted-foreground">/</span> : breadcrumbs.map((crumb) => <span key={crumb.path} className="flex items-center text-sm"><span className="text-muted-foreground">/</span><button type="button" className="text-muted-foreground hover:text-foreground hover:underline" onClick={() => onNavigateTo(crumb.path)}>{crumb.name}</button></span>)}</div>
}

function FileActions({ selected, currentPath, view, showMkdir, mkdirPending, transferActionPending, directoryMutationBusy, selectedMutationBusy, onUpload, onDownload, onNavigateTo, onSetView, onToggleMkdir, onRename, onDelete }: { selected: FileInfo | null; currentPath: string; view: SFTPDefaultView; showMkdir: boolean; mkdirPending: boolean; transferActionPending: 'upload' | 'download' | null; directoryMutationBusy: boolean; selectedMutationBusy: boolean; onUpload: () => void; onDownload: (path: string) => void; onNavigateTo: (path: string) => void; onSetView: (view: SFTPDefaultView) => void; onToggleMkdir: () => void; onRename: () => void; onDelete: () => void }) {
  const transferPending = transferActionPending !== null
  return <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-3 py-1.5"><Button size="xs" variant="outline" disabled={transferPending || directoryMutationBusy} onClick={onUpload}>{transferActionPending === 'upload' ? t('处理中…') : t('上传')}</Button><Button size="xs" variant="outline" disabled={mkdirPending || (directoryMutationBusy && !showMkdir)} aria-pressed={showMkdir} onClick={onToggleMkdir}>{t('新建文件夹')}</Button><Button size="xs" variant="outline" disabled={!selected || transferPending || selectedMutationBusy} onClick={() => { if (selected) onDownload(selected.path) }}>{transferActionPending === 'download' ? t('处理中…') : t('下载')}</Button><Button size="xs" variant="outline" disabled={!selected || selectedMutationBusy} onClick={onRename}>{t('重命名')}</Button><Button size="xs" variant="destructive" disabled={!selected || selectedMutationBusy} onClick={onDelete}>{t('删除')}</Button><Button size="xs" variant="ghost" onClick={() => onNavigateTo(currentPath)}>{t('刷新')}</Button><div className="flex items-center rounded-md border border-border p-0.5" role="group" aria-label={t('文件视图')}><Button size="icon-xs" variant={view === 'list' ? 'secondary' : 'ghost'} aria-label={t('列表视图')} onClick={() => onSetView('list')}><List /></Button><Button size="icon-xs" variant={view === 'tree' ? 'secondary' : 'ghost'} aria-label={t('树状视图')} onClick={() => onSetView('tree')}><FolderTree /></Button></div></div>
}

function useFileDialogRuntime({ panelOpen, renameOpen, deleteOpen, selectedPath, setBusy, setDeleteError }: {
  panelOpen: boolean
  renameOpen: boolean
  deleteOpen: boolean
  selectedPath?: string
  setBusy: (busy: boolean) => void
  setDeleteError: (error: string) => void
}) {
  const lifecycle = useRef(0)
  const generation = useRef(0)
  const requestID = useRef(0)
  const busyRef = useRef(false)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [])
  useEffect(() => {
    generation.current += 1
    setBusy(busyRef.current)
    setDeleteError('')
  }, [deleteOpen, panelOpen, renameOpen, selectedPath, setBusy, setDeleteError])
  return { lifecycle, generation, requestID, busyRef }
}

function beginFileDialogRequest(runtime: ReturnType<typeof useFileDialogRuntime>, panelOpen: boolean) {
  runtime.busyRef.current = true
  const lifecycleToken = runtime.lifecycle.current
  const generationToken = runtime.generation.current
  const id = ++runtime.requestID.current
  const isLatest = () => runtime.lifecycle.current === lifecycleToken && runtime.requestID.current === id
  return { id, isLatest, isCurrent: () => isLatest() && runtime.generation.current === generationToken && panelOpen }
}

function FileDialogs({ panelOpen, selected, renameOpen, renameName, deleteOpen, externalBusy, onRenameOpenChange, onRenameNameChange, onDeleteOpenChange, onRename, onDelete, onClearSelection, onMutationError }: { panelOpen: boolean; selected: FileInfo | null; renameOpen: boolean; renameName: string; deleteOpen: boolean; externalBusy: boolean; onRenameOpenChange: (open: boolean) => void; onRenameNameChange: (name: string) => void; onDeleteOpenChange: (open: boolean) => void; onRename: Props['onRename']; onDelete: Props['onDelete']; onClearSelection: () => void; onMutationError: (message: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const runtime = useFileDialogRuntime({ panelOpen, renameOpen, deleteOpen, selectedPath: selected?.path, setBusy, setDeleteError })
  const saveRename = async () => {
    if (!selected || !renameName.trim() || runtime.busyRef.current || externalBusy) return
    const request = beginFileDialogRequest(runtime, panelOpen)
    setBusy(true)
    onMutationError('')
    try {
      await onRename(selected.path, renameName.trim(), selected.isDir)
      if (request.isCurrent()) onRenameOpenChange(false)
    } catch (error) {
      if (request.isCurrent()) onMutationError(t('重命名失败: ${}', errorText(error)))
    } finally {
      if (runtime.requestID.current === request.id) runtime.busyRef.current = false
      if (request.isLatest()) setBusy(false)
    }
  }
  const confirmDelete = async () => {
    if (!selected || runtime.busyRef.current || externalBusy) return
    const request = beginFileDialogRequest(runtime, panelOpen)
    setBusy(true)
    setDeleteError('')
    try {
      await onDelete(selected.path, selected.isDir)
      if (request.isCurrent()) {
        onDeleteOpenChange(false)
        onClearSelection()
      }
    } catch (error) {
      if (request.isCurrent()) setDeleteError(t('删除文件失败: ${}', errorText(error)))
    } finally {
      if (runtime.requestID.current === request.id) runtime.busyRef.current = false
      if (request.isLatest()) setBusy(false)
    }
  }
  return <>
    <Dialog open={panelOpen && renameOpen} onOpenChange={(open) => { if (!busy) onRenameOpenChange(open) }}><DialogContent showCloseButton={!busy}><DialogHeader><DialogTitle>{t('重命名')}</DialogTitle></DialogHeader><Input disabled={busy || externalBusy} value={renameName} onChange={(event) => onRenameNameChange(event.target.value)} autoFocus /><DialogFooter><Button variant="outline" disabled={busy} onClick={() => onRenameOpenChange(false)}>{t('取消')}</Button><Button disabled={busy || externalBusy} onClick={() => { void saveRename() }}>{t('保存')}</Button></DialogFooter></DialogContent></Dialog>
    <AlertDialog open={panelOpen && deleteOpen} onOpenChange={(open) => { if (!busy) { if (!open) setDeleteError(''); onDeleteOpenChange(open) } }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('删除“')}{selected?.name}”</AlertDialogTitle><AlertDialogDescription>{t('远程文件删除后无法恢复。')}</AlertDialogDescription></AlertDialogHeader>{deleteError ? <Alert variant="destructive"><AlertDescription>{deleteError}</AlertDescription></Alert> : null}<AlertDialogFooter><AlertDialogCancel disabled={busy}>{t('取消')}</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={busy || externalBusy} onClick={() => { void confirmDelete() }}>{t('删除')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>
}
