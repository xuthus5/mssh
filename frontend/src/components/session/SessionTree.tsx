import { useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react'
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem,
  ContextMenuSeparator, ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent,
} from '@/components/ui/context-menu'
import { ChevronRight, ChevronDown, Folder as FolderIcon, Server } from 'lucide-react'
import type { Folder, Session } from '@/hooks/useSession'
import { Badge } from '@/components/ui/badge'
import { VirtualList } from '@/components/ui/virtual-list'
import { buildVisibleSessionTreeNodes, type SessionTreeNode } from '@/lib/sessionTreeModel'
import { isTreeNavigationKey, nextTreeIndex } from '@/lib/treeKeyboard'

interface Props {
  folders: Folder[]
  sessions: Session[]
  onConnect: (sessionId: string) => void
  onEditSession?: (session: Session) => void
  onDeleteSession?: (sessionId: string) => void
  onEditFolder?: (folder: Folder) => void
  onDeleteFolder?: (folderId: string) => void
  onMoveToFolder?: (sessionId: string, folderId: string | null) => void
  onSelectFolder?: (folderId: string) => void
  navigationOnly?: boolean
  revealAll?: boolean
}

const ROW = 32
const VIRTUALIZE_AFTER = 80

export default function SessionTree(props: Props) {
  const {
    folders, sessions, onConnect, onEditSession, onDeleteSession, onEditFolder, onDeleteFolder,
    onMoveToFolder, onSelectFolder, navigationOnly = false, revealAll = false,
  } = props
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [activeIndex, setActiveIndex] = useState(0)
  const toggleFolder = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const nodes = useMemo(
    () => buildVisibleSessionTreeNodes(folders, sessions, expanded, revealAll),
    [folders, sessions, expanded, revealAll],
  )
  const activeId = nodes[Math.min(Math.max(activeIndex, 0), Math.max(nodes.length - 1, 0))]?.id

  const handleNodeKey = (event: KeyboardEvent, index: number, node: SessionTreeNode) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      if (!isTreeNavigationKey(event.key)) return
      const next = nextTreeIndex(index, event.key, nodes.length)
      if (next !== null) { setActiveIndex(next); event.preventDefault() }
      return
    }
    if (node.kind === 'folder') {
      if (event.key === 'Enter' || event.key === ' ') {
        toggleFolder(node.folder.id); onSelectFolder?.(node.folder.id); event.preventDefault()
      } else if (event.key === 'ArrowRight' && !node.expanded) {
        toggleFolder(node.folder.id); event.preventDefault()
      } else if (event.key === 'ArrowLeft' && node.expanded) {
        toggleFolder(node.folder.id); event.preventDefault()
      }
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      onConnect(node.session.id)
      event.preventDefault()
    }
  }

  const renderNode = (node: SessionTreeNode, index: number) => (
    <TreeRow
      key={node.id}
      node={node}
      active={index === activeIndex}
      navigationOnly={navigationOnly}
      folders={folders}
      onActivate={() => setActiveIndex(index)}
      onKeyDown={(event) => { event.stopPropagation(); handleNodeKey(event, index, node) }}
      onToggleFolder={toggleFolder}
      onSelectFolder={onSelectFolder}
      onConnect={onConnect}
      onEditSession={onEditSession}
      onDeleteSession={onDeleteSession}
      onEditFolder={onEditFolder}
      onDeleteFolder={onDeleteFolder}
      onMoveToFolder={onMoveToFolder}
    />
  )

  return (
    <div
      role="tree"
      aria-label="会话列表"
      aria-activedescendant={activeId}
      tabIndex={0}
      className="flex h-full flex-col p-2 outline-none"
      onKeyDown={(event) => {
        const node = nodes[activeIndex]
        if (node) handleNodeKey(event, activeIndex, node)
      }}
    >
      <div className="mb-2 px-1 text-xs font-medium text-muted-foreground">会话列表</div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {nodes.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">暂无会话</p>
        ) : nodes.length > VIRTUALIZE_AFTER ? (
          <VirtualList items={nodes} estimateSize={ROW} getKey={(node) => node.id} renderItem={(node, index) => renderNode(node, index)} />
        ) : (
          nodes.map((node, index) => renderNode(node, index))
        )}
      </div>
    </div>
  )
}

function TreeRow(props: {
  node: SessionTreeNode
  active: boolean
  navigationOnly: boolean
  folders: Folder[]
  onActivate: () => void
  onKeyDown: (event: KeyboardEvent) => void
  onToggleFolder: (id: string) => void
  onSelectFolder?: (folderId: string) => void
  onConnect: (sessionId: string) => void
  onEditSession?: (session: Session) => void
  onDeleteSession?: (sessionId: string) => void
  onEditFolder?: (folder: Folder) => void
  onDeleteFolder?: (folderId: string) => void
  onMoveToFolder?: (sessionId: string, folderId: string | null) => void
}) {
  if (props.node.kind === 'folder') {
    const folder = props.node.folder
    const row = (
      <div
        id={props.node.id}
        role="treeitem"
        aria-expanded={props.node.expanded}
        tabIndex={0}
        className={`flex cursor-pointer select-none items-center gap-1 rounded px-1 py-1 text-sm hover:bg-muted/50 ${props.active ? 'bg-muted' : ''}`}
        style={{ paddingLeft: 4 + props.node.depth * 12 }}
        onClick={() => { props.onActivate(); props.onToggleFolder(folder.id); props.onSelectFolder?.(folder.id) }}
        onDoubleClick={(event: MouseEvent) => { event.preventDefault(); event.stopPropagation() }}
        onKeyDown={props.onKeyDown}
      >
        <span className="shrink-0">{props.node.expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</span>
        <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{folder.name}</span>
        {folder.isDefault ? <Badge className="ml-auto">默认</Badge> : null}
      </div>
    )
    if (props.navigationOnly) return row
    return (
      <ContextMenu>
        <ContextMenuTrigger>{row}</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => props.onEditFolder?.(folder)}>编辑</ContextMenuItem>
          <ContextMenuItem variant="destructive" onClick={() => props.onDeleteFolder?.(folder.id)}>删除</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )
  }

  const session = props.node.session
  const detail = `主机：${session.host}\n端口：${session.port}\n用户：${session.username}`
  const row = (
    <div
      id={props.node.id}
      role="treeitem"
      tabIndex={0}
      title={detail}
      aria-label={session.name}
      className={`flex cursor-pointer select-none items-center gap-1 rounded px-1 py-1 text-sm hover:bg-muted/50 ${props.active ? 'bg-muted' : ''}`}
      style={{ paddingLeft: 4 + props.node.depth * 12 }}
      onClick={props.onActivate}
      onDoubleClick={(event: MouseEvent) => { event.preventDefault(); props.onConnect(session.id) }}
      onKeyDown={props.onKeyDown}
    >
      <Server className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{session.name}</span>
      <span className="sr-only">{`主机：${session.host}`}</span>
      <span className="sr-only">{`端口：${session.port}`}</span>
      <span className="sr-only">{`用户：${session.username}`}</span>
    </div>
  )
  if (props.navigationOnly) return row
  return (
    <ContextMenu>
      <ContextMenuTrigger>{row}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => props.onConnect(session.id)}>连接</ContextMenuItem>
        <ContextMenuItem onClick={() => props.onEditSession?.(session)}>编辑</ContextMenuItem>
        {props.onMoveToFolder ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuSub>
              <ContextMenuSubTrigger>移动到</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem onClick={() => props.onMoveToFolder?.(session.id, null)}>根目录</ContextMenuItem>
                {props.folders.map((folder) => (
                  <ContextMenuItem key={folder.id} onClick={() => props.onMoveToFolder?.(session.id, folder.id)}>{folder.name}</ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          </>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={() => props.onDeleteSession?.(session.id)}>删除</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
