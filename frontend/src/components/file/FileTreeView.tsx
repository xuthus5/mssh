import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { ChevronDown, ChevronRight, File, Folder, FolderOpen } from 'lucide-react'
import type { FileInfo } from '@/hooks/useFileTransfer'
import { formatFileSize } from '@/components/file/FileListView'
import { logger } from '@/lib/logger'
import { isTreeNavigationKey, nextTreeIndex } from '@/lib/treeKeyboard'
import { VirtualList } from '@/components/ui/virtual-list'
import { t } from '@/i18n'


/** Flattened visible nodes above this count use VirtualList. */
export const FILE_TREE_VIRTUALIZE_THRESHOLD = 80

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

type FlatNode = { file: FileInfo; depth: number; expanded?: boolean }

export function FileTreeView(props: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [children, setChildren] = useState<Record<string, FileInfo[]>>({})
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(() => new Set())
  const [activeIndex, setActiveIndex] = useState(0)
  useEffect(() => { setExpanded(new Set()); setChildren({}); setLoadingPaths(new Set()); setActiveIndex(0) }, [props.currentPath])

  const toggle = async (file: FileInfo) => {
    if (!file.isDir) return
    if (expanded.has(file.path)) { setExpanded(withoutPath(expanded, file.path)); return }
    setExpanded(withPath(expanded, file.path))
    if (children[file.path]) return
    setLoadingPaths((current) => withPath(current, file.path))
    try {
      const loaded = await props.onLoadDirectory(file.path)
      setChildren((current) => ({ ...current, [file.path]: loaded }))
    } catch (error) {
      logger.error('load SFTP tree directory failed', error)
      setExpanded((current) => withoutPath(current, file.path))
    } finally {
      setLoadingPaths((current) => withoutPath(current, file.path))
    }
  }

  const rootFiles = filterHiddenFiles(props.files, props.showHiddenFiles)
  const flat = useMemo(() => flatten(rootFiles, expanded, children, props.showHiddenFiles, 0), [rootFiles, expanded, children, props.showHiddenFiles])
  const active = flat[Math.min(activeIndex, Math.max(flat.length - 1, 0))]

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isTreeNavigationKey(event.key)) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      const next = nextTreeIndex(activeIndex, event.key, flat.length)
      if (next !== null) {
        setActiveIndex(next)
        props.onSelect(flat[next].file)
        event.preventDefault()
      }
      return
    }
    if (!active) return
    if (active.file.isDir && event.key === 'ArrowRight') { void toggle(active.file); event.preventDefault() }
    if (active.file.isDir && event.key === 'ArrowLeft' && expanded.has(active.file.path)) { setExpanded(withoutPath(expanded, active.file.path)); event.preventDefault() }
    if (event.key === 'Enter' || event.key === ' ') {
      if (active.file.isDir) props.onNavigate(active.file.path)
      else props.onDownload(active.file.path)
      event.preventDefault()
    }
  }

  const renderNode = (node: FlatNode, index: number) => {
    const selected = props.selected?.path === node.file.path || index === activeIndex
    return (
      <div
        key={node.file.path}
        id={`file-${node.file.path}`}
        role="treeitem"
        aria-expanded={node.file.isDir ? expanded.has(node.file.path) : undefined}
        className={selected ? 'flex h-8 items-center gap-1 bg-muted px-2 text-sm' : 'flex h-8 items-center gap-1 px-2 text-sm hover:bg-muted/60'}
        style={{ paddingLeft: `${8 + node.depth * 16}px` }}
        onClick={() => { setActiveIndex(index); props.onSelect(node.file) }}
        onDoubleClick={() => { if (node.file.isDir) props.onNavigate(node.file.path); else props.onDownload(node.file.path) }}
      >
        {node.file.isDir ? (
          <button type="button" className="shrink-0" aria-label={expanded.has(node.file.path) ? t('收起 ${}', node.file.name) : t('展开 ${}', node.file.name)} onClick={(event) => { event.stopPropagation(); void toggle(node.file) }}>
            {expanded.has(node.file.path) ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        ) : <span className="w-3.5" />}
        {node.file.isDir ? (expanded.has(node.file.path) ? <FolderOpen className="size-4" /> : <Folder className="size-4" />) : <File className="size-4" />}
        <span className="truncate">{node.file.name}</span>
        {!node.file.isDir ? <span className="ml-auto text-xs text-muted-foreground">{formatFileSize(node.file.size)}</span> : null}
        {loadingPaths.has(node.file.path) ? <span className="ml-2 text-xs text-muted-foreground">...</span> : null}
      </div>
    )
  }

  return (
    <div role="tree" aria-label={t('远程文件树')} aria-activedescendant={active ? `file-${active.file.path}` : undefined} tabIndex={0} className="min-h-0 min-w-0 py-1 outline-none" onKeyDown={onKeyDown}>
      {props.loading ? <TreeEmpty text={t('加载中...')} /> : flat.length === 0 ? <TreeEmpty text={t('空目录')} /> : flat.length > FILE_TREE_VIRTUALIZE_THRESHOLD ? (
        <div className="h-full min-h-[12rem]">
          <VirtualList items={flat} estimateSize={32} getKey={(node) => node.file.path} renderItem={(node, index) => renderNode(node, index)} />
        </div>
      ) : flat.map((node, index) => renderNode(node, index))}
    </div>
  )
}

function flatten(files: FileInfo[], expanded: Set<string>, children: Record<string, FileInfo[]>, showHidden: boolean, depth: number): FlatNode[] {
  const nodes: FlatNode[] = []
  for (const file of filterHiddenFiles(files, showHidden)) {
    const open = expanded.has(file.path)
    nodes.push({ file, depth, expanded: open })
    if (file.isDir && open) nodes.push(...flatten(children[file.path] ?? [], expanded, children, showHidden, depth + 1))
  }
  return nodes
}

export function filterHiddenFiles(files: FileInfo[], showHiddenFiles: boolean) {
  return showHiddenFiles ? files : files.filter((file) => !file.name.startsWith('.'))
}
function withPath(paths: Set<string>, path: string) { const next = new Set(paths); next.add(path); return next }
function withoutPath(paths: Set<string>, path: string) { const next = new Set(paths); next.delete(path); return next }
function TreeEmpty({ text }: { text: string }) { return <div className="px-3 py-4 text-sm text-muted-foreground">{text}</div> }
