import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import type { Folder, Session } from '@/hooks/useSession'
import { buildVisibleSessionTreeNodes, type SessionTreeNode } from '@/lib/sessionTreeModel'
import { isTreeNavigationKey, nextTreeIndex } from '@/lib/treeKeyboard'

interface Options {
  folders: Folder[]
  sessions: Session[]
  revealAll: boolean
  onConnect: (sessionId: string) => void
  onSelectFolder?: (folderId: string) => void
}

export function useSessionTreeNavigation(options: Options) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [activeIndex, setActiveIndex] = useState(0)
  const nodes = useMemo(
    () => buildVisibleSessionTreeNodes(options.folders, options.sessions, expanded, options.revealAll),
    [expanded, options.folders, options.revealAll, options.sessions],
  )
  const resolvedActiveIndex = clampTreeIndex(activeIndex, nodes.length)
  const activeId = nodes[resolvedActiveIndex]?.id
  useActiveTreeNodeScroll(activeId)
  const toggleFolder = useCallback((id: string) => {
    setExpanded((current) => toggleExpandedFolder(current, id))
  }, [])
  const handleNodeKey = useCallback((event: KeyboardEvent, index: number, node: SessionTreeNode) => {
    handleTreeNodeKey({ event, index, node, nodes, setActiveIndex, toggleFolder, ...options })
  }, [nodes, options, toggleFolder])
  return { nodes, activeIndex: resolvedActiveIndex, activeId, setActiveIndex, toggleFolder, handleNodeKey }
}

function useActiveTreeNodeScroll(activeId?: string) {
  useEffect(() => {
    if (!activeId) return
    const element = document.getElementById(activeId)
    if (element && typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'nearest' })
  }, [activeId])
}

function handleTreeNodeKey(options: Options & {
  event: KeyboardEvent
  index: number
  node: SessionTreeNode
  nodes: SessionTreeNode[]
  setActiveIndex: (index: number) => void
  toggleFolder: (id: string) => void
}) {
  const { event, index, node, nodes, setActiveIndex, toggleFolder } = options
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
    if (!isTreeNavigationKey(event.key)) return
    const next = nextTreeIndex(index, event.key, nodes.length)
    if (next !== null) setActiveIndex(next)
    event.preventDefault()
    return
  }
  if (node.kind === 'folder') {
    handleFolderKey({ event, node, toggleFolder, onSelectFolder: options.onSelectFolder })
    return
  }
  if (event.key === 'Enter' || event.key === ' ') {
    options.onConnect(node.session.id)
    event.preventDefault()
  }
}

function handleFolderKey(options: {
  event: KeyboardEvent
  node: Extract<SessionTreeNode, { kind: 'folder' }>
  toggleFolder: (id: string) => void
  onSelectFolder?: (folderId: string) => void
}) {
  const { event, node, toggleFolder, onSelectFolder } = options
  const shouldToggle = event.key === 'Enter' || event.key === ' '
    || (event.key === 'ArrowRight' && !node.expanded)
    || (event.key === 'ArrowLeft' && node.expanded)
  if (!shouldToggle) return
  toggleFolder(node.folder.id)
  if (event.key === 'Enter' || event.key === ' ') onSelectFolder?.(node.folder.id)
  event.preventDefault()
}

function toggleExpandedFolder(current: Set<string>, id: string) {
  const next = new Set(current)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

function clampTreeIndex(index: number, length: number) {
  return Math.min(Math.max(index, 0), Math.max(length - 1, 0))
}
