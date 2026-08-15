import { useRef, type MouseEvent, type ReactNode } from 'react'
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem,
  ContextMenuSeparator, ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent,
} from '@/components/ui/context-menu'
import { ChevronRight, ChevronDown, Folder as FolderIcon, Server } from 'lucide-react'
import type { Folder, Session } from '@/hooks/useSession'
import { Badge } from '@/components/ui/badge'
import { VirtualList } from '@/components/ui/virtual-list'
import type { SessionTreeNode } from '@/lib/sessionTreeModel'
import { t } from '@/i18n'
import { useSessionTreeNavigation } from '@/components/session/useSessionTreeNavigation'

interface Props {
  folders: Folder[]
  sessions: Session[]
  onConnect: (sessionId: string) => void
  onEditSession?: (session: Session) => void
  onDuplicateSession?: (session: Session) => void | Promise<void>
  onQuickRenameSession?: (session: Session) => void
  onCopyCredentials?: (session: Session) => void | Promise<void>
  onDeleteSession?: (sessionId: string) => void
  onEditFolder?: (folder: Folder) => void
  onDeleteFolder?: (folderId: string) => void
  onMoveToFolder?: (sessionId: string, folderId: string | null) => void | Promise<void>
  onSelectFolder?: (folderId: string) => void
  expandedFolderIDs?: string[]
  onExpandedFolderIDsChange?: (ids: string[]) => void
  navigationOnly?: boolean
  revealAll?: boolean
}

const ROW = 32
const VIRTUALIZE_AFTER = 80

export default function SessionTree(props: Props) {
  const { folders, sessions, onConnect, onSelectFolder, navigationOnly = false, revealAll = false } = props
  const treeRef = useRef<HTMLDivElement>(null)
  const navigation = useSessionTreeNavigation({ folders, sessions, revealAll, expandedFolderIDs: props.expandedFolderIDs, onExpandedFolderIDsChange: props.onExpandedFolderIDsChange, onConnect, onSelectFolder })
  const renderNode = (node: SessionTreeNode, index: number) => (
    <TreeRow
      {...props}
      key={node.id}
      node={node}
      active={index === navigation.activeIndex}
      navigationOnly={navigationOnly}
      onActivate={() => {
        navigation.setActiveIndex(index)
        treeRef.current?.focus()
      }}
      onToggleFolder={navigation.toggleFolder}
    />
  )

  return (
    <div
      ref={treeRef}
      role="tree"
      aria-label={t('会话列表')}
      aria-activedescendant={navigation.activeId}
      tabIndex={0}
      className="flex h-full flex-col p-2 outline-none"
      onKeyDown={(event) => {
        const node = navigation.nodes[navigation.activeIndex]
        if (node) navigation.handleNodeKey(event, navigation.activeIndex, node)
      }}
    >
      <div className="mb-2 px-1 text-xs font-medium text-muted-foreground">{t('会话列表')}</div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SessionTreeRows navigation={navigation} renderNode={renderNode} />
      </div>
    </div>
  )
}

interface SessionTreeRowsProps {
  navigation: ReturnType<typeof useSessionTreeNavigation>
  renderNode: (node: SessionTreeNode, index: number) => ReactNode
}

function SessionTreeRows({ navigation, renderNode }: SessionTreeRowsProps) {
  if (navigation.nodes.length === 0) return <p className="px-1 text-xs text-muted-foreground">{t('暂无会话')}</p>
  if (navigation.nodes.length <= VIRTUALIZE_AFTER) return navigation.nodes.map(renderNode)
  return <VirtualList
    items={navigation.nodes}
    estimateSize={ROW}
    getKey={(node) => node.id}
    renderItem={renderNode}
    scrollToIndex={navigation.activeIndex}
  />
}

interface TreeRowProps {
  node: SessionTreeNode
  active: boolean
  navigationOnly: boolean
  folders: Folder[]
  onActivate: () => void
  onToggleFolder: (id: string) => void
  onSelectFolder?: (folderId: string) => void
  onConnect: (sessionId: string) => void
  onEditSession?: (session: Session) => void
  onDuplicateSession?: (session: Session) => void | Promise<void>
  onQuickRenameSession?: (session: Session) => void
  onCopyCredentials?: (session: Session) => void | Promise<void>
  onDeleteSession?: (sessionId: string) => void
  onEditFolder?: (folder: Folder) => void
  onDeleteFolder?: (folderId: string) => void
  onMoveToFolder?: (sessionId: string, folderId: string | null) => void | Promise<void>
}

function TreeRow(props: TreeRowProps) {
  return props.node.kind === 'folder' ? <FolderTreeRow {...props} node={props.node} /> : <SessionTreeRow {...props} node={props.node} />
}

function FolderTreeRow(props: TreeRowProps & { node: Extract<SessionTreeNode, { kind: 'folder' }> }) {
  const folder = props.node.folder
  const row = (
      <div
        id={props.node.id}
        role="treeitem"
        aria-expanded={props.node.expanded}
        aria-selected={props.active}
        className={`flex cursor-pointer select-none items-center gap-1 rounded px-1 py-1 text-sm hover:bg-muted/50 ${props.active ? 'bg-muted' : ''}`}
        style={{ paddingLeft: 4 + props.node.depth * 12 }}
        onClick={() => { props.onActivate(); props.onToggleFolder(folder.id); props.onSelectFolder?.(folder.id) }}
        onDoubleClick={(event: MouseEvent) => { event.preventDefault(); event.stopPropagation() }}
      >
        <span className="shrink-0">{props.node.expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</span>
        <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{folder.name}</span>
        {folder.isDefault ? <Badge className="ml-auto">{t('默认')}</Badge> : null}
      </div>
  )
  if (props.navigationOnly) return row
  return <TreeContextMenu row={row}>
    <ContextMenuItem onClick={() => props.onEditFolder?.(folder)}>{t('编辑')}</ContextMenuItem>
    <ContextMenuItem variant="destructive" onClick={() => props.onDeleteFolder?.(folder.id)}>{t('删除')}</ContextMenuItem>
  </TreeContextMenu>
}

function SessionTreeRow(props: TreeRowProps & { node: Extract<SessionTreeNode, { kind: 'session' }> }) {
  const session = props.node.session
  const detail = t('主机：${}\n端口：${}\n用户：${}', session.host, session.port, session.username)
  const row = (
    <div
      id={props.node.id}
      role="treeitem"
      aria-selected={props.active}
      title={detail}
      aria-label={session.name}
      className={`flex cursor-pointer select-none items-center gap-1 rounded px-1 py-1 text-sm hover:bg-muted/50 ${props.active ? 'bg-muted' : ''}`}
      style={{ paddingLeft: 4 + props.node.depth * 12 }}
      onClick={props.onActivate}
      onDoubleClick={(event: MouseEvent) => { event.preventDefault(); props.onConnect(session.id) }}
    >
      <Server className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{session.name}</span>
      <span className="sr-only">{t('主机：${}', session.host)}</span>
      <span className="sr-only">{t('端口：${}', session.port)}</span>
      <span className="sr-only">{t('用户：${}', session.username)}</span>
    </div>
  )
  if (props.navigationOnly) return row
  return <TreeContextMenu row={row}><SessionTreeActions {...props} session={session} /></TreeContextMenu>
}

function SessionTreeActions(props: TreeRowProps & { session: Session }) {
  const { session } = props
  return <>
    <ContextMenuItem onClick={() => props.onConnect(session.id)}>{t('连接')}</ContextMenuItem>
    <ContextMenuItem onClick={() => props.onEditSession?.(session)}>{t('编辑')}</ContextMenuItem>
    <ContextMenuItem onClick={() => runSessionAction(props.onDuplicateSession, session)}>{t('复制会话')}</ContextMenuItem>
    <ContextMenuItem onClick={() => props.onQuickRenameSession?.(session)}>{t('快速重命名')}</ContextMenuItem>
    <ContextMenuItem onClick={() => runSessionAction(props.onCopyCredentials, session)}>{t('复制账号密码')}</ContextMenuItem>
    {props.onMoveToFolder ? <SessionMoveActions {...props} session={session} /> : null}
    <ContextMenuSeparator />
    <ContextMenuItem variant="destructive" onClick={() => props.onDeleteSession?.(session.id)}>{t('删除')}</ContextMenuItem>
  </>
}

function runSessionAction(action: ((session: Session) => void | Promise<void>) | undefined, session: Session) {
  void Promise.resolve(action?.(session)).catch(() => undefined)
}

function SessionMoveActions(props: TreeRowProps & { session: Session }) {
  return <><ContextMenuSeparator /><ContextMenuSub><ContextMenuSubTrigger>{t('移动到')}</ContextMenuSubTrigger>
    <ContextMenuSubContent>
      <ContextMenuItem onClick={() => moveSession(props, null)}>{t('根目录')}</ContextMenuItem>
      {props.folders.map((folder) => <ContextMenuItem key={folder.id} onClick={() => moveSession(props, folder.id)}>{folder.name}</ContextMenuItem>)}
    </ContextMenuSubContent>
  </ContextMenuSub></>
}

function TreeContextMenu({ row, children }: { row: ReactNode; children: ReactNode }) {
  return <ContextMenu><ContextMenuTrigger>{row}</ContextMenuTrigger><ContextMenuContent>{children}</ContextMenuContent></ContextMenu>
}

function moveSession(props: TreeRowProps & { session: Session }, folderId: string | null) {
  void Promise.resolve(props.onMoveToFolder?.(props.session.id, folderId)).catch(() => undefined)
}
