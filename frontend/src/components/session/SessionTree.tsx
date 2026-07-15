import { useState, type MouseEvent } from 'react'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from '@/components/ui/context-menu'
import { ChevronRight, ChevronDown, Folder as FolderIcon, Server } from 'lucide-react'
import type { Folder, Session } from '@/hooks/useSession'
import { logger } from '@/lib/logger'
import { Badge } from '@/components/ui/badge'

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

export default function SessionTree({
  folders,
  sessions,
  onConnect,
  onEditSession,
  onDeleteSession,
  onEditFolder,
  onDeleteFolder,
  onMoveToFolder,
  onSelectFolder,
  navigationOnly = false,
  revealAll = false,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggleFolder = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const rootFolders = folders.filter((f) => f.parentId === null)
  const getChildFolders = (parentId: string) =>
    folders.filter((f) => f.parentId === parentId)
  const getFolderSessions = (folderId: string | null) =>
    sessions.filter((s) => s.folderId === folderId)

  const renderFolder = (folder: Folder) => {
    const children = getChildFolders(folder.id)
    const folderSessions = getFolderSessions(folder.id)
    const isExpanded = revealAll || expanded.has(folder.id)

    const folderRow = <div
      role="treeitem"
      tabIndex={0}
      aria-expanded={isExpanded}
      className="flex cursor-pointer select-none items-center gap-1 rounded px-1 py-1 text-sm hover:bg-muted/50"
      onClick={() => { toggleFolder(folder.id); onSelectFolder?.(folder.id) }}
      onDoubleClick={(event: MouseEvent) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') { toggleFolder(folder.id); onSelectFolder?.(folder.id) }
        if (event.key === 'ArrowRight' && !isExpanded) toggleFolder(folder.id)
        if (event.key === 'ArrowLeft' && isExpanded) toggleFolder(folder.id)
      }}
    >
      <span className="shrink-0">{isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</span>
      <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{folder.name}</span>
      {folder.isDefault && <Badge className="ml-auto">默认</Badge>}
    </div>
    return (
      <div key={folder.id}>
        {navigationOnly ? folderRow : <ContextMenu>
          <ContextMenuTrigger>
            {folderRow}
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              onClick={() => onEditFolder?.(folder)}
            >
              编辑
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              disabled={folder.isDefault || folders.length <= 1}
              onClick={() => onDeleteFolder?.(folder.id)}
            >
              删除
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>}
        {isExpanded && (
          <div className="ml-3">
            {children.map((child) => renderFolder(child))}
            {folderSessions.map((session) =>
              renderSession(session),
            )}
          </div>
        )}
      </div>
    )
  }

  const renderSession = (session: Session) => {
    const sessionRow = <div
      role="treeitem"
      tabIndex={0}
      className="ml-1 flex cursor-pointer select-none items-center gap-1 rounded px-1 py-1 text-sm hover:bg-muted/50"
      onDoubleClick={(event: MouseEvent) => {
        event.preventDefault()
        event.stopPropagation()
        logger.debug('SessionTree: onConnect', session.id)
        onConnect(session.id)
      }}
      onKeyDown={(event) => { if (event.key === 'Enter') onConnect(session.id) }}
    ><Server className="size-3.5 shrink-0 text-muted-foreground" /><span className="truncate">{session.name}</span></div>
    if (navigationOnly) return <div key={session.id}>{sessionRow}</div>
    return <ContextMenu key={session.id}>
      <ContextMenuTrigger>
        {sessionRow}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => { logger.debug('SessionTree: onConnect', session.id); onConnect(session.id) }}>
          连接
        </ContextMenuItem>
        <ContextMenuItem onClick={() => { logger.debug('SessionTree: onEditSession', session.id); onEditSession?.(session) }}>
          编辑
        </ContextMenuItem>
        <ContextMenuSeparator />
        {onMoveToFolder && folders.length > 0 && (
          <>
            <ContextMenuSub>
              <ContextMenuSubTrigger>移动到分组</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {folders.map((f) => (
                  <ContextMenuItem
                    key={f.id}
                    onClick={() => onMoveToFolder(session.id, f.id)}
                  >
                    {f.name}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem
          variant="destructive"
          onClick={() => { logger.debug('SessionTree: onDeleteSession', session.id); onDeleteSession?.(session.id) }}
        >
          删除
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  }

  return (
    <div role="tree" aria-label="会话列表" className="flex flex-col h-full p-2">
      <div className="text-xs font-medium text-muted-foreground mb-2 px-1">
        会话列表
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {rootFolders.map((folder) => renderFolder(folder))}
        {getFolderSessions(null).map((session) =>
          renderSession(session),
        )}
        {rootFolders.length === 0 && getFolderSessions(null).length === 0 && (
          <p className="text-xs text-muted-foreground px-1">
            暂无会话
          </p>
        )}
      </div>
    </div>
  )
}
