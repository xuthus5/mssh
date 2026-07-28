import { useMemo, useRef, type ReactNode, type RefObject } from 'react'
import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual'
import { Server } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  SESSION_ASSET_HEADER_HEIGHT,
  SESSION_ASSET_VIRTUAL_INITIAL_RECT,
  SESSION_ASSET_VIRTUAL_OVERSCAN,
  SESSION_ASSET_VIRTUAL_ROW_HEIGHT,
  SESSION_ASSET_VIRTUALIZATION_THRESHOLD,
} from '@/components/session/SessionAssetTable.constants'
import { SessionAssetTableRow } from '@/components/session/SessionAssetTableRow'
import type { Folder, Session } from '@/hooks/useSession'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

interface Props {
  sessions: Session[]
  folders: Folder[]
  selectedIDs: Set<string>
  recent?: boolean
  movingSessionIDs?: ReadonlySet<string>
  onSelectionChange: (ids: Set<string>) => void
  onConnect: (id: string) => void
  onOpenDetail: (session: Session) => void
  onEdit: (session: Session) => void
  onDelete: (session: Session) => void
  onMove: (id: string, folderID: string | null) => void | Promise<void>
}

export function SessionAssetTable(props: Props) {
  if (props.sessions.length === 0) return <SessionAssetEmpty recent={props.recent} />
  return <PopulatedSessionAssetTable {...props} />
}

function PopulatedSessionAssetTable(props: Props) {
  const folderNames = useMemo(() => buildFolderNameIndex(props.folders), [props.folders])
  const allSelected = props.sessions.every((session) => props.selectedIDs.has(session.id))
  const toggleAll = () => props.onSelectionChange(toggleAllSessions(props, allSelected))

  if (props.sessions.length > SESSION_ASSET_VIRTUALIZATION_THRESHOLD) {
    return <VirtualizedSessionAssetTable {...props} allSelected={allSelected} folderNames={folderNames} onToggleAll={toggleAll} />
  }
  return <FullSessionAssetTable {...props} allSelected={allSelected} folderNames={folderNames} onToggleAll={toggleAll} />
}

interface PopulatedProps extends Props {
  allSelected: boolean
  folderNames: ReadonlyMap<string, string>
  onToggleAll: () => void
}

function FullSessionAssetTable(props: PopulatedProps) {
  return (
    <AssetTableSurface {...props}>
      <TableBody>
        {props.sessions.map((session, index) => (
          <SessionAssetTableRow key={session.id} {...props} session={session} folderName={folderNameFor(props.folderNames, session)} ariaRowIndex={index + 2} />
        ))}
      </TableBody>
    </AssetTableSurface>
  )
}

function VirtualizedSessionAssetTable(props: PopulatedProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({
    count: props.sessions.length,
    estimateSize: estimateAssetRowSize,
    getItemKey: (index) => props.sessions[index].id,
    getScrollElement: () => scrollRef.current,
    initialRect: SESSION_ASSET_VIRTUAL_INITIAL_RECT,
    overscan: SESSION_ASSET_VIRTUAL_OVERSCAN,
    scrollMargin: SESSION_ASSET_HEADER_HEIGHT,
  })
  const virtualRows = rowVirtualizer.getVirtualItems()

  return (
    <AssetTableSurface {...props} scrollRef={scrollRef} virtualized>
      <VirtualTableBody {...props} totalSize={rowVirtualizer.getTotalSize()} virtualRows={virtualRows} />
    </AssetTableSurface>
  )
}

interface VirtualBodyProps extends PopulatedProps {
  totalSize: number
  virtualRows: VirtualItem[]
}

function VirtualTableBody(props: VirtualBodyProps) {
  const firstRow = props.virtualRows[0]
  const lastRow = props.virtualRows.at(-1)
  const topPadding = firstRow ? firstRow.start - SESSION_ASSET_HEADER_HEIGHT : 0
  const bottomPadding = lastRow ? props.totalSize - lastRow.end + SESSION_ASSET_HEADER_HEIGHT : 0

  return (
    <TableBody>
      <VirtualSpacer height={topPadding} recent={props.recent} />
      {props.virtualRows.map((virtualRow) => {
        const session = props.sessions[virtualRow.index]
        return <SessionAssetTableRow key={session.id} {...props} session={session} folderName={folderNameFor(props.folderNames, session)} ariaRowIndex={virtualRow.index + 2} virtualized />
      })}
      <VirtualSpacer height={bottomPadding} recent={props.recent} />
    </TableBody>
  )
}

interface SurfaceProps extends PopulatedProps {
  children: ReactNode
  scrollRef?: RefObject<HTMLDivElement | null>
  virtualized?: boolean
}

function AssetTableSurface(props: SurfaceProps) {
  return (
    <div
      ref={props.scrollRef}
      data-virtualized={props.virtualized ? 'true' : undefined}
      className={cn('overflow-auto rounded-xl border border-border shadow-sm', props.virtualized && 'h-[36rem]')}
    >
      <Table aria-rowcount={props.sessions.length + 1}>
        <SessionAssetTableHeader recent={props.recent} allSelected={props.allSelected} onToggleAll={props.onToggleAll} />
        {props.children}
      </Table>
    </div>
  )
}

function SessionAssetTableHeader({ recent, allSelected, onToggleAll }: Pick<SurfaceProps, 'recent' | 'allSelected' | 'onToggleAll'>) {
  return (
    <TableHeader>
      <TableRow aria-rowindex={1}>
        <TableHead className="w-10"><Checkbox aria-label={t('选择当前列表全部会话')} checked={allSelected} onCheckedChange={onToggleAll} /></TableHead>
        <TableHead>{t('名称')}</TableHead><TableHead>{t('端点')}</TableHead><TableHead>{t('环境')}</TableHead>
        <TableHead>{t('项目')}</TableHead><TableHead>{t('标签')}</TableHead><TableHead>{t('分组')}</TableHead>
        {recent ? <TableHead>{t('最近连接')}</TableHead> : null}
        <TableHead className="w-24 text-right">{t('操作')}</TableHead>
      </TableRow>
    </TableHeader>
  )
}

function VirtualSpacer({ height, recent }: { height: number; recent?: boolean }) {
  if (height <= 0) return null
  return <TableRow aria-hidden="true" className="border-0 hover:bg-transparent"><TableCell className="p-0" colSpan={recent ? 9 : 8} style={{ height }} /></TableRow>
}

function SessionAssetEmpty({ recent }: Pick<Props, 'recent'>) {
  return (
    <Empty className="min-h-64 border">
      <EmptyHeader><EmptyMedia variant="icon"><Server /></EmptyMedia>
        <EmptyTitle>{recent ? t('暂无最近连接') : t('暂无会话节点')}</EmptyTitle>
        <EmptyDescription>{recent ? t('成功连接会话后会显示在这里。') : t('调整筛选条件或创建第一个会话。')}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function buildFolderNameIndex(folders: readonly Folder[]) {
  const names = new Map<string, string>()
  for (const folder of folders) {
    if (!names.has(folder.id)) names.set(folder.id, folder.name)
  }
  return names
}

function folderNameFor(folderNames: ReadonlyMap<string, string>, session: Session) {
  if (!session.folderId) return t('未分组')
  return folderNames.get(session.folderId) ?? t('未分组')
}

function toggleAllSessions(props: Props, allSelected: boolean) {
  const next = new Set(props.selectedIDs)
  for (const session of props.sessions) {
    if (allSelected) next.delete(session.id)
    else next.add(session.id)
  }
  return next
}

function estimateAssetRowSize() {
  return SESSION_ASSET_VIRTUAL_ROW_HEIGHT
}
