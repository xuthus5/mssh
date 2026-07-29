import type { KeyboardEvent } from 'react'
import { Bot, MoreHorizontal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { TableCell, TableRow } from '@/components/ui/table'
import { SESSION_ASSET_VIRTUAL_ROW_STYLE } from '@/components/session/SessionAssetTable.constants'
import type { Folder, Session } from '@/hooks/useSession'
import { t } from '@/i18n'
import { openAIAgentCenter } from '@/lib/aiAgentEvents'

interface Props {
  session: Session
  folders: Folder[]
  folderName: string
  selectedIDs: Set<string>
  recent?: boolean
  movingSessionIDs?: ReadonlySet<string>
  ariaRowIndex: number
  virtualized?: boolean
  onSelectionChange: (ids: Set<string>) => void
  onConnect: (id: string) => void
  onOpenDetail: (session: Session) => void
  onEdit: (session: Session) => void
  onDelete: (session: Session) => void
  onMove: (id: string, folderID: string | null) => void | Promise<void>
}

export function SessionAssetTableRow(props: Props) {
  const selected = props.selectedIDs.has(props.session.id)
  const toggle = () => props.onSelectionChange(toggleSession(props.selectedIDs, props.session.id))
  const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => activateFromKeyboard(event, props)

  return (
    <TableRow
      aria-rowindex={props.ariaRowIndex}
      data-state={selected ? 'selected' : undefined}
      data-session-id={props.session.id}
      className="cursor-pointer"
      style={props.virtualized ? SESSION_ASSET_VIRTUAL_ROW_STYLE : undefined}
      tabIndex={0}
      onClick={() => props.onOpenDetail(props.session)}
      onDoubleClick={() => props.onConnect(props.session.id)}
      onKeyDown={handleKeyDown}
    >
      <TableCell onClick={stopPropagation} onDoubleClick={stopPropagation}>
        <Checkbox aria-label={t('选择 ${}', props.session.name)} checked={selected} onCheckedChange={toggle} />
      </TableCell>
      <TableCell className="font-medium">{props.session.name}</TableCell>
      <TableCell>{props.session.username}@{props.session.host}:{props.session.port}</TableCell>
      <AssetMetadataCells {...props} />
      <AssetActions {...props} />
    </TableRow>
  )
}

function AssetMetadataCells({ session, folderName, recent }: Pick<Props, 'session' | 'folderName' | 'recent'>) {
  const tags = session.tags ?? []
  return (
    <>
      <TableCell>{session.environment ? <Badge variant="outline" data-asset-color={session.environment.colorToken} className="asset-color-badge">{session.environment.name}</Badge> : <UnsetLabel>{t('未设置')}</UnsetLabel>}</TableCell>
      <TableCell>{session.project ? <Badge variant="secondary">{session.project.code || session.project.name}</Badge> : <UnsetLabel>{t('未关联')}</UnsetLabel>}</TableCell>
      <TableCell>
        <div className="flex max-w-48 items-center gap-1">
          {tags.slice(0, 2).map((tag) => <Badge key={tag.id} variant="outline" data-asset-color={tag.colorToken} className="asset-color-badge max-w-20 truncate">{tag.name}</Badge>)}
          {tags.length > 2 ? <span className="text-xs text-muted-foreground">+{tags.length - 2}</span> : null}
          {tags.length === 0 ? <UnsetLabel>{t('无')}</UnsetLabel> : null}
        </div>
      </TableCell>
      <TableCell>{folderName}</TableCell>
      {recent ? <TableCell>{formatRecent(session)}</TableCell> : null}
    </>
  )
}

function AssetActions(props: Props) {
  const moving = props.movingSessionIDs?.has(props.session.id) ?? false
  return (
    <TableCell onClick={stopPropagation} onDoubleClick={stopPropagation}>
      <div className="flex justify-end gap-1">
        <Button size="xs" onClick={() => props.onConnect(props.session.id)}>{t('连接')}</Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="icon-xs" variant="ghost" aria-label={t('${} 更多操作', props.session.name)} />}><MoreHorizontal /></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => props.onEdit(props.session)}>{t('编辑')}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => openAIAgentCenter({ sessionID: Number(props.session.id), sessionName: props.session.name })}><Bot />{t('运行 Agent')}</DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={moving} className="data-disabled:pointer-events-none data-disabled:opacity-50">{moving ? t('移动中…') : t('移动到分组')}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent><MoveTargets {...props} moving={moving} /></DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem variant="destructive" onClick={() => props.onDelete(props.session)}>{t('删除')}</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </TableCell>
  )
}

function MoveTargets({ session, folders, onMove, moving }: Pick<Props, 'session' | 'folders' | 'onMove'> & { moving: boolean }) {
  return (
    <DropdownMenuGroup>
      {folders.map((folder) => (
        <DropdownMenuItem
          key={folder.id}
          disabled={moving || folder.id === session.folderId}
          onClick={() => { void Promise.resolve(onMove(session.id, folder.id)).catch((_error) => undefined) }}
        >
          {folder.name}
        </DropdownMenuItem>
      ))}
    </DropdownMenuGroup>
  )
}

function UnsetLabel({ children }: { children: string }) {
  return <span className="text-xs text-muted-foreground">{children}</span>
}

function activateFromKeyboard(event: KeyboardEvent<HTMLTableRowElement>, props: Props) {
  if (event.key !== 'Enter') return
  if (event.ctrlKey) props.onConnect(props.session.id)
  else props.onOpenDetail(props.session)
}

function toggleSession(selectedIDs: Set<string>, sessionID: string) {
  const next = new Set(selectedIDs)
  if (next.has(sessionID)) next.delete(sessionID)
  else next.add(sessionID)
  return next
}

function stopPropagation(event: { stopPropagation: () => void }) {
  event.stopPropagation()
}

function formatRecent(session: Session) {
  return t('${} · ${} 次', session.lastConnectedAt ? new Date(session.lastConnectedAt).toLocaleString() : '-', session.connectionCount ?? 0)
}
