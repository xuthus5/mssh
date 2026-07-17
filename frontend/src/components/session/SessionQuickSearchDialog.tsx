import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { CornerDownLeft, Folder as FolderIcon, Search, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { Folder, Session } from '@/hooks/useSession'
import { SESSION_QUICK_SEARCH_EVENT } from '@/lib/sessionQuickSearch'
import { sessionAssetSearchText } from '@/lib/sessionAssetSearch'
import { Badge } from '@/components/ui/badge'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessions: Session[]
  folders: Folder[]
  onConnect: (sessionId: string) => void
}

function folderNames(folders: Folder[]) {
  return new Map(folders.map((folder) => [folder.id, folder.name]))
}

function sessionSearchText(session: Session, folderName: string) {
  return sessionAssetSearchText(session, folderName)
}

function filterSessions(sessions: Session[], folders: Folder[], query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return sessions
  const names = folderNames(folders)
  return sessions.filter((session) => {
    const folderName = names.get(session.folderId ?? '') ?? ''
    return sessionSearchText(session, folderName).includes(normalizedQuery)
  })
}

function nextSelection(current: number, direction: number, total: number) {
  if (total === 0) return 0
  return (current + direction + total) % total
}

function EmptyResults({ hasSessions }: { hasSessions: boolean }) {
  return <div className="flex min-h-36 flex-col items-center justify-center gap-2 px-6 text-center">
    <Server className="size-8 text-muted-foreground/50" />
    <p className="text-sm font-medium">{hasSessions ? '未找到匹配会话' : '暂无会话'}</p>
    <p className="text-xs text-muted-foreground">
      {hasSessions ? '尝试搜索名称、主机、用户、分组、环境、项目或标签' : '请先创建会话，再使用快速连接'}
    </p>
  </div>
}

interface ResultProps {
  session: Session
  optionId: string
  folderName: string
  selected: boolean
  onSelect: () => void
  onActivate: () => void
}

function SessionResult({ session, optionId, folderName, selected, onSelect, onActivate }: ResultProps) {
  return <Button id={optionId} type="button" variant="ghost" role="option" aria-selected={selected}
    className="h-auto w-full justify-start gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left aria-selected:border-border aria-selected:bg-muted"
    onClick={onSelect} onMouseEnter={onSelect} onDoubleClick={onActivate}>
    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background shadow-sm">
      <Server className="size-4 text-muted-foreground" />
    </span>
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-medium text-foreground">{session.name}</span>
      <span className="block truncate text-xs font-normal text-muted-foreground">
        {session.username}@{session.host}:{session.port}
      </span>
      <span className="mt-1 flex min-w-0 items-center gap-1 overflow-hidden">
        {session.environment && <Badge variant="outline" data-asset-color={session.environment.colorToken} className="asset-color-badge max-w-24 truncate">{session.environment.name}</Badge>}
        {session.project && <Badge variant="secondary" className="max-w-24 truncate">{session.project.code || session.project.name}</Badge>}
        {(session.tags ?? []).slice(0, 2).map((tag) => <Badge key={tag.id} variant="outline" data-asset-color={tag.colorToken} className="asset-color-badge max-w-20 truncate">{tag.name}</Badge>)}
        {(session.tags?.length ?? 0) > 2 && <span className="text-[10px] text-muted-foreground">+{(session.tags?.length ?? 0) - 2}</span>}
      </span>
    </span>
    <span className="flex max-w-36 shrink-0 items-center gap-1 truncate text-xs font-normal text-muted-foreground">
      <FolderIcon className="size-3.5" />{folderName}
    </span>
  </Button>
}

interface SearchFieldProps {
  query: string
  listboxId: string
  activeOptionId?: string
  inputRef: RefObject<HTMLInputElement | null>
  onQueryChange: (query: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
}

function SearchHeader() {
  return <DialogHeader className="border-b border-border px-4 pb-3 pt-4">
    <div className="flex items-center justify-between gap-4 pr-8">
      <DialogTitle>快速连接会话</DialogTitle>
      <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
        Ctrl F
      </span>
    </div>
    <DialogDescription>搜索名称、主机、用户、分组、环境、项目或标签</DialogDescription>
  </DialogHeader>
}

function SearchField({ query, listboxId, activeOptionId, inputRef, onQueryChange, onKeyDown }: SearchFieldProps) {
  return <div className="px-4">
    <div className="relative">
      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input ref={inputRef} autoFocus data-session-search-input type="search" role="searchbox" aria-label="搜索会话"
        aria-controls={listboxId} aria-activedescendant={activeOptionId} value={query}
        onChange={(event) => onQueryChange(event.target.value)} onKeyDown={onKeyDown}
        placeholder="输入关键词快速连接..." className="h-10 pl-9 pr-10" />
      <CornerDownLeft className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  </div>
}

interface SearchResultsProps {
  listboxId: string
  sessions: Session[]
  names: Map<string, string>
  selectedIndex: number
  hasSessions: boolean
  onSelect: (index: number) => void
  onActivate: (session: Session) => void
}

function SearchResults({ listboxId, sessions, names, selectedIndex, hasSessions, onSelect, onActivate }: SearchResultsProps) {
  if (sessions.length === 0) return <ScrollArea className="max-h-80 min-h-36 px-2 pb-3">
    <EmptyResults hasSessions={hasSessions} />
  </ScrollArea>
  return <ScrollArea className="max-h-80 min-h-36 px-2 pb-3">
    <div id={listboxId} role="listbox" aria-label="会话搜索结果" className="flex flex-col gap-1 px-2">
      {sessions.map((session, index) => <SessionResult key={session.id} session={session}
        optionId={`${listboxId}-${session.id}`} folderName={names.get(session.folderId ?? '') ?? '未分组'}
        selected={index === selectedIndex} onSelect={() => onSelect(index)} onActivate={() => onActivate(session)} />)}
    </div>
  </ScrollArea>
}

export function SessionQuickSearchDialog({ open, onOpenChange, sessions, folders, onConnect }: Props) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()
  const filtered = useMemo(() => filterSessions(sessions, folders, query), [folders, query, sessions])
  const names = useMemo(() => folderNames(folders), [folders])
  const activeOptionId = filtered[selectedIndex] ? `${listboxId}-${filtered[selectedIndex].id}` : undefined
  useEffect(() => { setSelectedIndex(0) }, [open, query, filtered.length])
  useEffect(() => { if (!open) setQuery('') }, [open])
  useEffect(() => { if (activeOptionId) document.getElementById(activeOptionId)?.scrollIntoView?.({ block: 'nearest' }) }, [activeOptionId])
  useEffect(() => {
    const focusSearch = () => inputRef.current?.focus()
    window.addEventListener(SESSION_QUICK_SEARCH_EVENT, focusSearch)
    return () => window.removeEventListener(SESSION_QUICK_SEARCH_EVENT, focusSearch)
  }, [])
  const activate = (session: Session | undefined) => {
    if (!session) return
    onOpenChange(false)
    onConnect(session.id)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex((current) => nextSelection(current, event.key === 'ArrowDown' ? 1 : -1, filtered.length))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      activate(filtered[selectedIndex])
    }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="gap-3 overflow-hidden p-0 sm:max-w-xl">
      <SearchHeader />
      <SearchField query={query} listboxId={listboxId} activeOptionId={activeOptionId} inputRef={inputRef}
        onQueryChange={setQuery} onKeyDown={handleKeyDown} />
      <SearchResults listboxId={listboxId} sessions={filtered} names={names} selectedIndex={selectedIndex}
        hasSessions={sessions.length > 0} onSelect={setSelectedIndex} onActivate={activate} />
    </DialogContent>
  </Dialog>
}
