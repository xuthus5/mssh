import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
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
  isMutationBusy?: (file: FileInfo) => boolean
  catalogRevision?: number
}

type FlatNode = { file: FileInfo; depth: number; expanded?: boolean }

export function FileTreeView(props: Props) {
  const state = useFileTreeState(props)
  const toggle = useDirectoryToggle(props, state)
  const treeID = `file-tree-${useId().replace(/[^A-Za-z0-9_-]/g, '_')}`
  const activeIndex = Math.min(state.activeIndex, Math.max(state.flat.length - 1, 0))
  const active = state.flat[activeIndex]
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => handleTreeKey({ event, active, state, toggle, props })
  const renderNode = (node: FlatNode, index: number) => (
    <FileTreeNode node={node} index={index} itemID={`${treeID}-${index}`} state={state} props={props} toggle={toggle} />
  )
  return (
    <div role="tree" aria-label={t('远程文件树')} aria-activedescendant={active ? `${treeID}-${activeIndex}` : undefined} tabIndex={0} className="min-h-0 min-w-0 py-1 outline-none" onKeyDown={onKeyDown}>
      {props.loading ? <TreeEmpty text={t('加载中...')} /> : state.flat.length === 0 ? <TreeEmpty text={t('空目录')} /> : (
        <FileTreeItems flat={state.flat} activeIndex={activeIndex} renderNode={renderNode} />
      )}
    </div>
  )
}

function useFileTreeState(props: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [children, setChildren] = useState<Record<string, FileInfo[]>>({})
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(() => new Set())
  const [errorPaths, setErrorPaths] = useState<Record<string, string>>({})
  const [activePath, setActivePath] = useState<string | null>(null)
  const generation = useRef(0)
  useEffect(() => {
    const token = ++generation.current
    setExpanded(new Set())
    setChildren({})
    setLoadingPaths(new Set())
    setErrorPaths({})
    setActivePath(null)
    return () => { if (generation.current === token) generation.current++ }
  }, [props.catalogRevision, props.currentPath, props.onLoadDirectory])
  const rootFiles = filterHiddenFiles(props.files, props.showHiddenFiles)
  const flat = useMemo(() => flatten(rootFiles, expanded, children, props.showHiddenFiles, 0), [rootFiles, expanded, children, props.showHiddenFiles])
  const requestedPath = props.selected?.path ?? activePath
  const requestedIndex = requestedPath ? flat.findIndex((node) => node.file.path === requestedPath) : 0
  const activeIndex = requestedIndex >= 0 ? requestedIndex : 0
  const setActiveIndex = (index: number) => setActivePath(flat[index]?.file.path ?? null)
  useEffect(() => {
    if (activePath && !flat.some((node) => node.file.path === activePath)) setActivePath(null)
  }, [activePath, flat])
  return { expanded, setExpanded, children, setChildren, loadingPaths, setLoadingPaths, errorPaths, setErrorPaths, activeIndex, setActiveIndex, generation, flat }
}

type FileTreeState = ReturnType<typeof useFileTreeState>

function useDirectoryToggle(props: Props, state: FileTreeState) {
  return async (file: FileInfo) => {
    if (!file.isDir || props.isMutationBusy?.(file)) return
    if (state.expanded.has(file.path)) { state.setExpanded(withoutPath(state.expanded, file.path)); return }
    if (state.loadingPaths.has(file.path)) return
    const requestGeneration = state.generation.current
    state.setExpanded(withPath(state.expanded, file.path))
    if (state.children[file.path]) return
    state.setLoadingPaths((current) => withPath(current, file.path))
    try {
      const loaded = await props.onLoadDirectory(file.path)
      if (state.generation.current !== requestGeneration) return
      state.setChildren((current) => ({ ...current, [file.path]: loaded }))
      state.setErrorPaths((current) => {
        if (!(file.path in current)) return current
        const next = { ...current }
        delete next[file.path]
        return next
      })
    } catch (error) {
      if (state.generation.current !== requestGeneration) return
      const message = error instanceof Error ? error.message : String(error)
      logger.error('load SFTP tree directory failed', error)
      state.setErrorPaths((current) => ({ ...current, [file.path]: message }))
      state.setExpanded((current) => withoutPath(current, file.path))
    } finally {
      if (state.generation.current === requestGeneration) state.setLoadingPaths((current) => withoutPath(current, file.path))
    }
  }
}

function handleTreeKey(options: {
  event: KeyboardEvent<HTMLDivElement>
  active: FlatNode | undefined
  state: FileTreeState
  toggle: (file: FileInfo) => Promise<void>
  props: Props
}) {
    const { event, active, state, toggle, props } = options
    if (!isTreeNavigationKey(event.key)) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      const next = nextTreeIndex(state.activeIndex, event.key, state.flat.length)
      if (next !== null) {
        state.setActiveIndex(next)
        props.onSelect(state.flat[next].file)
        event.preventDefault()
      }
      return
    }
    if (!active) return
    if (props.isMutationBusy?.(active.file)) { event.preventDefault(); return }
    if (active.file.isDir && event.key === 'ArrowRight') { void toggle(active.file); event.preventDefault() }
    if (active.file.isDir && event.key === 'ArrowLeft' && state.expanded.has(active.file.path)) { state.setExpanded(withoutPath(state.expanded, active.file.path)); event.preventDefault() }
    if (event.key === 'Enter' || event.key === ' ') {
      if (active.file.isDir) props.onNavigate(active.file.path)
      else props.onDownload(active.file.path)
      event.preventDefault()
    }
}

function FileTreeNode({ node, index, itemID, state, props, toggle }: {
  node: FlatNode
  index: number
  itemID: string
  state: FileTreeState
  props: Props
  toggle: (file: FileInfo) => Promise<void>
}) {
  const selected = props.selected?.path === node.file.path || index === state.activeIndex
  const busy = props.isMutationBusy?.(node.file) ?? false
  return (
      <div
        key={node.file.path}
        id={itemID}
        role="treeitem"
        aria-expanded={node.file.isDir ? state.expanded.has(node.file.path) : undefined}
        aria-disabled={busy}
        className={selected ? 'flex h-8 items-center gap-1 bg-muted px-2 text-sm' : 'flex h-8 items-center gap-1 px-2 text-sm hover:bg-muted/60'}
        style={{ paddingLeft: `${8 + node.depth * 16}px` }}
        onClick={() => { state.setActiveIndex(index); props.onSelect(node.file) }}
        onDoubleClick={() => { if (busy) return; if (node.file.isDir) props.onNavigate(node.file.path); else props.onDownload(node.file.path) }}
      >
        {node.file.isDir ? (
          <button type="button" disabled={busy} className="shrink-0 disabled:cursor-not-allowed disabled:opacity-50" aria-label={state.expanded.has(node.file.path) ? t('收起 ${}', node.file.name) : t('展开 ${}', node.file.name)} onClick={(event) => { event.stopPropagation(); void toggle(node.file) }}>
            {state.expanded.has(node.file.path) ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        ) : <span className="w-3.5" />}
        {node.file.isDir ? (state.expanded.has(node.file.path) ? <FolderOpen className="size-4" /> : <Folder className="size-4" />) : <File className="size-4" />}
        <span className="truncate">{node.file.name}</span>
        {!node.file.isDir ? <span className="ml-auto text-xs text-muted-foreground">{formatFileSize(node.file.size)}</span> : null}
        {state.loadingPaths.has(node.file.path) ? <span className="ml-2 text-xs text-muted-foreground">...</span> : null}
        {state.errorPaths[node.file.path] ? (
          <span className="ml-auto max-w-[12rem] truncate text-xs text-destructive" title={state.errorPaths[node.file.path]} role="alert">
            {t('加载失败')}
          </span>
        ) : null}
      </div>
  )
}

function FileTreeItems({ flat, activeIndex, renderNode }: { flat: FlatNode[]; activeIndex: number; renderNode: (node: FlatNode, index: number) => ReactNode }) {
  return (
    flat.length > FILE_TREE_VIRTUALIZE_THRESHOLD ? <div className="h-full min-h-[12rem]">
      <VirtualList items={flat} estimateSize={32} scrollToIndex={activeIndex} getKey={(node) => node.file.path} renderItem={renderNode} />
    </div> : flat.map(renderNode)
  )
}

function flatten(...args: [FileInfo[], Set<string>, Record<string, FileInfo[]>, boolean, number]): FlatNode[] {
  const [files, expanded, children, showHidden, depth] = args
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
