import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { ChevronDown, ChevronUp, Regex, Search, X } from 'lucide-react'
import type { ISearchOptions, ISearchResultChangeEvent, SearchAddon } from '@xterm/addon-search'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getTerminalSearch, subscribeTerminalSearch } from '@/lib/terminalSearchRegistry'
import { useAppStore } from '@/store/appStore'

const decorations: NonNullable<ISearchOptions['decorations']> = {
  matchBackground: '#92400e',
  matchBorder: '#f59e0b',
  matchOverviewRuler: '#f59e0b',
  activeMatchBackground: '#b91c1c',
  activeMatchBorder: '#fca5a5',
  activeMatchColorOverviewRuler: '#ef4444',
}

interface Props {
  terminalID: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

function searchOptions(regex: boolean, incremental = false): ISearchOptions {
  return { regex, caseSensitive: false, incremental, decorations }
}

function validateQuery(query: string, regex: boolean) {
  if (!regex || query.length === 0) return ''
  try {
    new RegExp(query, 'i')
    return ''
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }
}

function useSearchAddon(terminalID: string) {
  return useSyncExternalStore(subscribeTerminalSearch, () => getTerminalSearch(terminalID), () => null)
}

function runSearch(addon: SearchAddon | null, query: string, regex: boolean, direction: 'next' | 'previous', incremental = false) {
  if (!addon || !query) return false
  const options = searchOptions(regex, incremental)
  return direction === 'next' ? addon.findNext(query, options) : addon.findPrevious(query, options)
}

export function TerminalSearchBar({ terminalID, open, onOpenChange }: Props) {
  const addon = useSearchAddon(terminalID)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [regex, setRegex] = useState(false)
  const [result, setResult] = useState<ISearchResultChangeEvent>({ resultIndex: -1, resultCount: 0 })
  const error = validateQuery(query, regex)

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [open, terminalID])
  useEffect(() => {
    if (!open || !addon) return
    const disposable = addon.onDidChangeResults(setResult)
    return () => disposable.dispose()
  }, [addon, open])
  useEffect(() => {
    if (!open || !addon) return
    if (!query || error) {
      addon.clearDecorations()
      setResult({ resultIndex: -1, resultCount: 0 })
      return
    }
    runSearch(addon, query, regex, 'next', true)
    return () => addon.clearActiveDecoration()
  }, [addon, error, open, query, regex])
  useEffect(() => () => addon?.clearDecorations(), [addon])

  if (!open) return null
  const close = () => {
    addon?.clearDecorations()
    onOpenChange(false)
    useAppStore.getState().terminalPool.get(terminalID)?.terminal.focus()
  }
  const navigate = (direction: 'next' | 'previous') => {
    if (!error) runSearch(addon, query, regex, direction)
    inputRef.current?.focus()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      navigate(event.shiftKey ? 'previous' : 'next')
    }
  }
  const position = result.resultCount === 0 ? '0 / 0' : `${result.resultIndex + 1} / ${result.resultCount}`

  return <div role="search" aria-label="搜索终端内容" className="absolute right-2 top-2 z-30 flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-xl border border-border bg-card/95 p-1.5 shadow-lg backdrop-blur">
    <Search className="ml-1 size-4 shrink-0 text-muted-foreground" />
    <div className="min-w-32 max-w-72 flex-1">
      <Input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown}
        aria-label="搜索活跃终端" aria-invalid={Boolean(error)} placeholder="搜索终端内容" className="h-7 border-0 bg-transparent px-1.5 text-xs shadow-none focus-visible:ring-0" />
      {error ? <p role="alert" className="px-1.5 pt-1 text-[10px] text-destructive">正则表达式无效</p> : null}
    </div>
    <span aria-label="搜索结果位置" className="min-w-12 text-center text-[11px] tabular-nums text-muted-foreground">{position}</span>
    <Button type="button" size="icon-xs" variant={regex ? 'secondary' : 'ghost'} aria-label="使用正则表达式" aria-pressed={regex} onClick={() => setRegex((value) => !value)}><Regex /></Button>
    <Button type="button" size="icon-xs" variant="ghost" aria-label="上一个搜索结果" disabled={!query || Boolean(error)} onClick={() => navigate('previous')}><ChevronUp /></Button>
    <Button type="button" size="icon-xs" variant="ghost" aria-label="下一个搜索结果" disabled={!query || Boolean(error)} onClick={() => navigate('next')}><ChevronDown /></Button>
    <Button type="button" size="icon-xs" variant="ghost" aria-label="关闭终端搜索" onClick={close}><X /></Button>
  </div>
}
