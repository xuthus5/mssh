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

interface Props {
  folders: Folder[]
  sessions: Session[]
  onConnect: (sessionId: string) => void
  onEditSession: (session: Session) => void
  onDeleteSession: (sessionId: string) => void
  onEditFolder: (folder: Folder) => void
  onDeleteFolder: (folderId: string) => void
  onMoveToFolder?: (sessionId: string, folderId: string | null) => void
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
    const isExpanded = expanded.has(folder.id)

    return (
      <div key={folder.id}>
        <ContextMenu>
          <ContextMenuTrigger>
            <div
              className="flex items-center gap-1 py-1 px-1 cursor-pointer hover:bg-muted/50 rounded text-sm"
              onClick={() => toggleFolder(folder.id)}
            >
              <span className="flex-shrink-0">
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </span>
              <FolderIcon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <span className="truncate">{folder.name}</span>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              onClick={() => onEditFolder(folder)}
            >
              编辑
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onClick={() => onDeleteFolder(folder.id)}
            >
              删除
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
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

  const renderSession = (session: Session) => (
    <ContextMenu key={session.id}>
      <ContextMenuTrigger>
        <div
          className="flex items-center gap-1 py-1 px-1 cursor-pointer hover:bg-muted/50 rounded text-sm ml-1"
          onDoubleClick={(e: MouseEvent) => {
            e.stopPropagation()
            logger.debug('SessionTree: onConnect', session.id)
            onConnect(session.id)
          }}
        >
          <Server className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <span className="truncate">{session.name}</span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => { logger.debug('SessionTree: onConnect', session.id); onConnect(session.id) }}>
          连接
        </ContextMenuItem>
        <ContextMenuItem onClick={() => { logger.debug('SessionTree: onEditSession', session.id); onEditSession(session) }}>
          编辑
        </ContextMenuItem>
        <ContextMenuSeparator />
        {onMoveToFolder && folders.length > 0 && (
          <>
            <ContextMenuSub>
              <ContextMenuSubTrigger>移动到分组</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem
                  onClick={() => onMoveToFolder(session.id, null)}
                >
                  无分组
                </ContextMenuItem>
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
          onClick={() => { logger.debug('SessionTree: onDeleteSession', session.id); onDeleteSession(session.id) }}
        >
          删除
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )

  return (
    <div className="flex flex-col h-full p-2">
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
