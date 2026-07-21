import { useState, useEffect, type FormEvent } from 'react'
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


interface Props {
  open: boolean
  onClose: () => void
  files: FileInfo[]
  currentPath: string
  loading: boolean
  error?: string
  onNavigateTo: (path: string) => void
  onNavigateUp: () => void
  onDelete: (path: string) => void
  onRename: (oldPath: string, newName: string) => void
  onMakeDir: (name: string) => void
  onUpload: () => void
  onDownload: (path: string) => void
  dropTargetId: string
  showHiddenFiles: boolean
  defaultView: SFTPDefaultView
  onLoadDirectory: (path: string) => Promise<FileInfo[]>
  onSyncCurrentDirectory: () => void
  syncingCurrentDirectory: boolean
}

export default function FilePanel({
  open,
  onClose,
  files,
  currentPath,
  loading,
  onNavigateTo,
  onNavigateUp,
  onDelete,
  onRename,
  onMakeDir,
  onUpload,
  onDownload,
  dropTargetId,
  error,
  showHiddenFiles,
  defaultView,
  onLoadDirectory,
  onSyncCurrentDirectory,
  syncingCurrentDirectory,
}: Props) {
  const state = useFilePanelState(defaultView, currentPath, onMakeDir)
  const panel = useToolPanelResize('files')
  if (!open) return null
  return (
    <aside id={dropTargetId} data-file-drop-target style={panel.panelStyle} className="group/drop relative flex-shrink-0 flex flex-col border-l border-border bg-card file-drop-target-active:ring-2 file-drop-target-active:ring-inset file-drop-target-active:ring-primary">
      <ToolPanelResizeHandle {...panel.resizeHandleProps} />
      <div className="pointer-events-none absolute inset-3 z-40 hidden place-items-center rounded-xl border-2 border-dashed border-primary bg-background/90 text-sm font-medium text-primary shadow-sm group-[.file-drop-target-active]/drop:grid">{t('释放文件以上传到当前目录')}</div>
      <PanelHeader onClose={onClose} onSyncCurrentDirectory={onSyncCurrentDirectory} syncingCurrentDirectory={syncingCurrentDirectory} />
      <PathBar currentPath={currentPath} onNavigateUp={onNavigateUp} onNavigateTo={onNavigateTo} />
      <FileActions selected={state.selected} currentPath={currentPath} view={state.view} showMkdir={state.showMkdir}
        onUpload={onUpload} onDownload={onDownload} onNavigateTo={onNavigateTo} onSetView={state.setView}
        onToggleMkdir={state.toggleMkdir} onRename={state.openRename} onDelete={state.openDelete} />
      {error && <Alert variant="destructive" className="m-2"><AlertTitle>{t('目录加载失败')}</AlertTitle><AlertDescription>{error}<Button size="xs" variant="outline" className="ml-2" onClick={() => onNavigateTo(currentPath)}>{t('重试')}</Button></AlertDescription></Alert>}
      {state.showMkdir && <MkdirForm name={state.mkdirName} onChange={state.setMkdirName} onSubmit={state.submitMkdir} />}
      <FileContent view={state.view} files={files} loading={loading} currentPath={currentPath} showHiddenFiles={showHiddenFiles}
        selected={state.selected} onSelect={state.setSelected} onNavigate={onNavigateTo} onDownload={onDownload} onLoadDirectory={onLoadDirectory} />
      <FileDialogs selected={state.selected} renameOpen={state.renameOpen} renameName={state.renameName} deleteOpen={state.deleteOpen}
        onRenameOpenChange={state.setRenameOpen} onRenameNameChange={state.setRenameName} onDeleteOpenChange={state.setDeleteOpen}
        onRename={onRename} onDelete={onDelete} onClearSelection={() => state.setSelected(null)} />
    </aside>
  )
}

function ToolPanelResizeHandle(props: ReturnType<typeof useToolPanelResize>['resizeHandleProps']) {
  return <div {...props} className="absolute inset-y-0 -left-1 z-30 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent hover:after:bg-primary/60 focus-visible:after:bg-primary active:after:bg-primary" />
}

function useFilePanelState(defaultView: SFTPDefaultView, currentPath: string, onMakeDir: (name: string) => void) {
  const [mkdirName, setMkdirName] = useState('')
  const [showMkdir, setShowMkdir] = useState(false)
  const [selected, setSelected] = useState<FileInfo | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameName, setRenameName] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [view, setView] = useState<SFTPDefaultView>(defaultView)
  useEffect(() => setMkdirName(''), [currentPath])
  useEffect(() => setView(defaultView), [defaultView])
  const submitMkdir = (event: FormEvent) => { event.preventDefault(); if (!mkdirName.trim()) return; onMakeDir(mkdirName.trim()); setMkdirName(''); setShowMkdir(false) }
  const openRename = () => { if (selected) { setRenameName(selected.name); setRenameOpen(true) } }
  return { mkdirName, setMkdirName, showMkdir, toggleMkdir: () => setShowMkdir((current) => !current), submitMkdir, selected, setSelected, renameOpen, setRenameOpen, renameName, setRenameName, openRename, deleteOpen, setDeleteOpen, openDelete: () => setDeleteOpen(true), view, setView }
}

function MkdirForm({ name, onChange, onSubmit }: { name: string; onChange: (name: string) => void; onSubmit: (event: FormEvent) => void }) {
  return <form onSubmit={onSubmit} className="flex items-center gap-1 border-b border-border px-3 py-1.5"><input className="h-7 flex-1 rounded border border-input bg-transparent px-2 text-sm outline-none" placeholder={t('文件夹名')} value={name} onChange={(event) => onChange(event.target.value)} autoFocus /><Button size="xs" type="submit">{t('确定')}</Button></form>
}

function FileContent({ view, files, loading, currentPath, showHiddenFiles, selected, onSelect, onNavigate, onDownload, onLoadDirectory }: { view: SFTPDefaultView; files: FileInfo[]; loading: boolean; currentPath: string; showHiddenFiles: boolean; selected: FileInfo | null; onSelect: (file: FileInfo) => void; onNavigate: (path: string) => void; onDownload: (path: string) => void; onLoadDirectory: (path: string) => Promise<FileInfo[]> }) {
  return <div className="min-h-0 flex-1 overflow-y-auto">{view === 'list' ? <FileListView files={filterHiddenFiles(files, showHiddenFiles)} loading={loading} selected={selected} onSelect={onSelect} onNavigate={onNavigate} onDownload={onDownload} /> : <FileTreeView currentPath={currentPath} files={files} loading={loading} showHiddenFiles={showHiddenFiles} selected={selected} onSelect={onSelect} onNavigate={onNavigate} onDownload={onDownload} onLoadDirectory={onLoadDirectory} />}</div>
}

function PanelHeader({ onClose, onSyncCurrentDirectory, syncingCurrentDirectory }: { onClose: () => void; onSyncCurrentDirectory: () => void; syncingCurrentDirectory: boolean }) {
  return <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2"><span className="text-sm font-medium">{t('文件管理')}</span><div className="flex shrink-0 items-center gap-1"><Button size="xs" variant="outline" title={t('同步当前终端的 Shell 工作目录（需要处于 Shell 提示符）')} disabled={syncingCurrentDirectory} onClick={onSyncCurrentDirectory}><RefreshCw className={syncingCurrentDirectory ? 'animate-spin' : undefined} data-icon="inline-start" />{syncingCurrentDirectory ? t('同步中') : t('同步当前目录')}</Button><Button size="xs" variant="ghost" onClick={onClose}>{t('关闭')}</Button></div></div>
}

function PathBar({ currentPath, onNavigateUp, onNavigateTo }: { currentPath: string; onNavigateUp: () => void; onNavigateTo: (path: string) => void }) {
  const breadcrumbs = currentPath.split('/').filter(Boolean).map((name, index, parts) => ({ name, path: `/${parts.slice(0, index + 1).join('/')}` }))
  return <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-3 py-1.5"><button type="button" aria-label={t('上级目录')} className="flex-shrink-0 rounded p-0.5 hover:bg-muted" onClick={onNavigateUp}><ArrowUp className="size-3.5" /></button>{currentPath === '/' ? <span className="text-sm text-muted-foreground">/</span> : breadcrumbs.map((crumb) => <span key={crumb.path} className="flex items-center text-sm"><span className="text-muted-foreground">/</span><button type="button" className="text-muted-foreground hover:text-foreground hover:underline" onClick={() => onNavigateTo(crumb.path)}>{crumb.name}</button></span>)}</div>
}

function FileActions({ selected, currentPath, view, showMkdir, onUpload, onDownload, onNavigateTo, onSetView, onToggleMkdir, onRename, onDelete }: { selected: FileInfo | null; currentPath: string; view: SFTPDefaultView; showMkdir: boolean; onUpload: () => void; onDownload: (path: string) => void; onNavigateTo: (path: string) => void; onSetView: (view: SFTPDefaultView) => void; onToggleMkdir: () => void; onRename: () => void; onDelete: () => void }) {
  return <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-3 py-1.5"><Button size="xs" variant="outline" onClick={onUpload}>{t('上传')}</Button><Button size="xs" variant="outline" aria-pressed={showMkdir} onClick={onToggleMkdir}>{t('新建文件夹')}</Button><Button size="xs" variant="outline" disabled={!selected} onClick={() => { if (selected) onDownload(selected.path) }}>{t('下载')}</Button><Button size="xs" variant="outline" disabled={!selected} onClick={onRename}>{t('重命名')}</Button><Button size="xs" variant="destructive" disabled={!selected} onClick={onDelete}>{t('删除')}</Button><Button size="xs" variant="ghost" onClick={() => onNavigateTo(currentPath)}>{t('刷新')}</Button><div className="flex items-center rounded-md border border-border p-0.5" role="group" aria-label={t('文件视图')}><Button size="icon-xs" variant={view === 'list' ? 'secondary' : 'ghost'} aria-label={t('列表视图')} onClick={() => onSetView('list')}><List /></Button><Button size="icon-xs" variant={view === 'tree' ? 'secondary' : 'ghost'} aria-label={t('树状视图')} onClick={() => onSetView('tree')}><FolderTree /></Button></div></div>
}

function FileDialogs({ selected, renameOpen, renameName, deleteOpen, onRenameOpenChange, onRenameNameChange, onDeleteOpenChange, onRename, onDelete, onClearSelection }: { selected: FileInfo | null; renameOpen: boolean; renameName: string; deleteOpen: boolean; onRenameOpenChange: (open: boolean) => void; onRenameNameChange: (name: string) => void; onDeleteOpenChange: (open: boolean) => void; onRename: (path: string, name: string) => void; onDelete: (path: string) => void; onClearSelection: () => void }) {
  return <><Dialog open={renameOpen} onOpenChange={onRenameOpenChange}><DialogContent><DialogHeader><DialogTitle>{t('重命名')}</DialogTitle></DialogHeader><Input value={renameName} onChange={(event) => onRenameNameChange(event.target.value)} autoFocus /><DialogFooter showCloseButton><Button onClick={() => { if (selected && renameName.trim()) onRename(selected.path, renameName.trim()); onRenameOpenChange(false) }}>{t('保存')}</Button></DialogFooter></DialogContent></Dialog><AlertDialog open={deleteOpen} onOpenChange={onDeleteOpenChange}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('删除“')}{selected?.name}”</AlertDialogTitle><AlertDialogDescription>{t('远程文件删除后无法恢复。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('取消')}</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { if (selected) onDelete(selected.path); onClearSelection() }}>{t('删除')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>
}
