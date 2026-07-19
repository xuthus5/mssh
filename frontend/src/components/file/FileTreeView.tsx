import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, File, Folder, FolderOpen } from 'lucide-react'
import type { FileInfo } from '@/hooks/useFileTransfer'
import { Button } from '@/components/ui/button'
import { formatFileSize } from '@/components/file/FileListView'
import { logger } from '@/lib/logger'

interface Props {
  currentPath: string
  files: FileInfo[]
  loading: boolean
  showHiddenFiles: boolean
  selected: FileInfo | null
  onSelect: (file: FileInfo) => void
  onNavigate: (path: string) => void
  onDownload: (path: string) => void
  onLoadDirectory: (path: string) => Promise<FileInfo[]>
}

export function FileTreeView(props: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [children, setChildren] = useState<Record<string, FileInfo[]>>({})
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(() => new Set())
  useEffect(() => { setExpanded(new Set()); setChildren({}); setLoadingPaths(new Set()) }, [props.currentPath])
  const toggle = async (file: FileInfo) => {
    if (!file.isDir) return
    if (expanded.has(file.path)) { setExpanded(withoutPath(expanded, file.path)); return }
    setExpanded(withPath(expanded, file.path))
    if (children[file.path]) return
    setLoadingPaths((current) => withPath(current, file.path))
    try {
      const loadedChildren = await props.onLoadDirectory(file.path)
      setChildren((current) => ({ ...current, [file.path]: loadedChildren }))
    } catch (error) {
      logger.error('load SFTP tree directory failed', error)
      setExpanded((current) => withoutPath(current, file.path))
    }
    finally { setLoadingPaths((current) => withoutPath(current, file.path)) }
  }
  const rootFiles = filterHiddenFiles(props.files, props.showHiddenFiles)
  return <div role="tree" aria-label="远程文件树" className="min-w-0 py-1">{props.loading ? <TreeEmpty text="加载中..." /> : rootFiles.length === 0 ? <TreeEmpty text="空目录" /> : rootFiles.map((file) => <TreeNode key={file.path} file={file} depth={0} {...props} expanded={expanded} children={children} loadingPaths={loadingPaths} onToggle={toggle} />)}</div>
}

interface NodeProps extends Omit<Props, 'currentPath' | 'files' | 'loading' | 'onLoadDirectory'> {
  file: FileInfo
  depth: number
  expanded: Set<string>
  children: Record<string, FileInfo[]>
  loadingPaths: Set<string>
  onToggle: (file: FileInfo) => Promise<void>
}

function TreeNode(props: NodeProps) {
  const open = props.expanded.has(props.file.path)
  const childFiles = filterHiddenFiles(props.children[props.file.path] ?? [], props.showHiddenFiles)
  return <><div role="treeitem" aria-expanded={props.file.isDir ? open : undefined} className={props.selected?.path === props.file.path ? 'flex h-8 items-center gap-1 bg-muted px-2 text-sm' : 'flex h-8 items-center gap-1 px-2 text-sm hover:bg-muted/60'} style={{ paddingLeft: `${8 + props.depth * 16}px` }} onClick={() => props.onSelect(props.file)} onDoubleClick={() => props.file.isDir ? props.onNavigate(props.file.path) : props.onDownload(props.file.path)}>
    {props.file.isDir ? <Button type="button" size="icon-xs" variant="ghost" aria-label={`${open ? '收起' : '展开'} ${props.file.name}`} onClick={(event) => { event.stopPropagation(); void props.onToggle(props.file) }}>{open ? <ChevronDown /> : <ChevronRight />}</Button> : <span className="inline-block size-6" />}
    {props.file.isDir ? open ? <FolderOpen className="size-4 shrink-0" /> : <Folder className="size-4 shrink-0" /> : <File className="size-4 shrink-0" />}
    <span className="min-w-0 flex-1 truncate">{props.file.name}</span><span className="shrink-0 text-xs text-muted-foreground">{props.file.isDir ? '' : formatFileSize(props.file.size)}</span>
  </div>{open && (props.loadingPaths.has(props.file.path) ? <div className="px-3 py-1 text-xs text-muted-foreground" style={{ paddingLeft: `${32 + props.depth * 16}px` }}>加载中...</div> : childFiles.map((child) => <TreeNode key={child.path} {...props} file={child} depth={props.depth + 1} />))}</>
}

export function filterHiddenFiles(files: FileInfo[], showHiddenFiles: boolean) {
  return showHiddenFiles ? files : files.filter((file) => !file.name.startsWith('.'))
}

function withPath(paths: Set<string>, path: string) { return new Set([...paths, path]) }
function withoutPath(paths: Set<string>, path: string) { const next = new Set(paths); next.delete(path); return next }
function TreeEmpty({ text }: { text: string }) { return <div className="px-3 py-8 text-center text-sm text-muted-foreground">{text}</div> }
