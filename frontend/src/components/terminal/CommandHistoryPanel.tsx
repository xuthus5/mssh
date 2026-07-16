import { useEffect, useMemo, useState } from 'react'
import { Clipboard, History, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { clearCommandHistory, readCommandHistory, type CommandHistoryEntry } from '@/lib/commandHistory'
import { CommandHistoryService } from '@/lib/wails'
import { logger } from '@/lib/logger'

export function CommandHistoryPanel({ sessionID, onClose, onFill }: { sessionID: number; onClose: () => void; onFill: (command: string) => void }) {
  const [entries, setEntries] = useState<CommandHistoryEntry[]>(() => readCommandHistory(sessionID))
  const [query, setQuery] = useState('')
  useEffect(() => {
    const load = async () => {
      try {
        const items = await CommandHistoryService.List(sessionID, '')
        setEntries((items ?? []).map((item: { id: number; command: string; created_at?: string; createdAt?: string }) => ({ id: String(item.id), command: item.command, createdAt: Date.parse(item.created_at ?? item.createdAt ?? '') || Date.now() })))
      } catch (error: unknown) { logger.error('command history loading failed', error) }
    }
    if (typeof CommandHistoryService?.List === 'function') void load()
  }, [sessionID])
  const filtered = useMemo(() => entries.filter((entry) => entry.command.toLowerCase().includes(query.toLowerCase())), [entries, query])
  const copy = async (command: string) => { try { await navigator.clipboard.writeText(command) } catch { /* clipboard unavailable */ } }
  const clear = () => { clearCommandHistory(sessionID); setEntries([]) }
  return <aside className="absolute inset-y-0 right-0 z-20 flex w-[340px] flex-col border-l border-border bg-card shadow-xl" data-testid="command-history-panel">
    <div className="flex items-center justify-between border-b border-border px-3 py-2"><span className="flex items-center gap-2 text-sm font-medium"><History className="size-4" />命令历史</span><Button size="icon-xs" variant="ghost" aria-label="关闭历史" onClick={onClose}><X /></Button></div>
    <div className="flex gap-2 border-b border-border p-2"><Input placeholder="搜索历史命令..." value={query} onChange={(event) => setQuery(event.target.value)} /><Button size="xs" variant="ghost" onClick={clear} disabled={entries.length === 0} title="清空历史"><Trash2 /></Button></div>
    <div className="min-h-0 flex-1 overflow-y-auto p-2">{filtered.length === 0 ? <p className="p-3 text-xs text-muted-foreground">暂无命令历史</p> : filtered.map((entry) => <div key={entry.id} className="group mb-1 rounded-md p-2 hover:bg-muted/60"><code className="block whitespace-pre-wrap break-all text-xs">{entry.command}</code><div className="mt-1 flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100"><Button size="xs" variant="ghost" onClick={() => void copy(entry.command)}><Clipboard />复制</Button><Button size="xs" variant="ghost" onClick={() => onFill(entry.command)}>填入终端</Button></div></div>)}</div>
  </aside>
}
