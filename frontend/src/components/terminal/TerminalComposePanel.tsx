import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { ClipboardPaste, PenLine, Play, RotateCw, X } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toast'
import { recordCommand } from '@/lib/commandHistory'
import { MacroService, TerminalService } from '@/lib/wails'
import { useAppStore } from '@/store/appStore'

interface Props { open: boolean; terminalID: string; sessionID: number; onClose: () => void }
interface MacroItem { id: number; name: string; command: string; shortcut: string }
type MacroState =
  | { status: 'idle' | 'loading' | 'ready'; items: MacroItem[]; error: '' }
  | { status: 'error'; items: MacroItem[]; error: string }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function commandWithEnter(command: string): string {
  return /[\r\n]$/.test(command) ? command : `${command}\r`
}

function useMacroCatalog(open: boolean) {
  const requestRef = useRef(0)
  const wasOpenRef = useRef(false)
  const [state, setState] = useState<MacroState>({ status: 'idle', items: [], error: '' })
  const load = useCallback(async () => {
    const requestID = ++requestRef.current
    setState({ status: 'loading', items: [], error: '' })
    try {
      const items = await MacroService.List()
      if (requestID === requestRef.current) setState({ status: 'ready', items: items ?? [], error: '' })
    } catch (error: unknown) {
      if (requestID === requestRef.current) setState({ status: 'error', items: [], error: errorMessage(error) })
    }
  }, [])
  useEffect(() => {
    const opening = open && !wasOpenRef.current
    wasOpenRef.current = open
    if (opening) void load()
  }, [load, open])
  useEffect(() => () => { requestRef.current += 1 }, [])
  return { load, state }
}

function useAsyncGate() {
  const activeRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const run = useCallback(async (action: () => Promise<void>, errorPrefix: string) => {
    if (activeRef.current) return
    activeRef.current = true
    setBusy(true)
    try {
      await action()
    } catch (error: unknown) {
      toast(`${errorPrefix}: ${errorMessage(error)}`, 'error')
    } finally {
      activeRef.current = false
      setBusy(false)
    }
  }, [])
  return { busy, run }
}

function MacroList({ state, busy, onExecute, onRetry }: {
  state: MacroState; busy: boolean; onExecute: (macro: MacroItem) => void; onRetry: () => void
}) {
  if (state.status === 'idle' || state.status === 'loading') {
    return <div aria-label="宏加载中" className="flex flex-1 gap-2"><Skeleton className="h-6 w-20" /><Skeleton className="h-6 w-24" /></div>
  }
  if (state.status === 'error') {
    return <Alert variant="destructive" className="flex-1 py-1.5"><AlertDescription className="flex items-center justify-between gap-2 text-xs">
      <span>宏加载失败: {state.error}</span><Button size="xs" variant="outline" onClick={onRetry}><RotateCw data-icon="inline-start" />重试</Button>
    </AlertDescription></Alert>
  }
  if (state.items.length === 0) return <span className="text-xs text-muted-foreground">暂无可用宏</span>
  return <div className="flex max-h-16 flex-1 flex-wrap gap-1.5 overflow-y-auto pr-1">
    {state.items.map((macro) => <Button key={macro.id} type="button" size="xs" variant="secondary" disabled={busy}
      aria-label={`执行宏 ${macro.name}`} title={macro.command} onClick={() => onExecute(macro)}>
      {macro.name}{macro.shortcut && <Badge variant="outline" className="h-4 px-1 text-[10px]">{macro.shortcut}</Badge>}
    </Button>)}
  </div>
}

interface PanelViewProps {
  busy: boolean; content: string; inputRef: RefObject<HTMLTextAreaElement | null>; macros: MacroState
  onChange: (value: string) => void; onClose: () => void; onExecute: () => void
  onExecuteMacro: (macro: MacroItem) => void; onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onPaste: () => void; onRetry: () => void
}

function ComposePanelView(props: PanelViewProps) {
  const hasContent = props.content.trim().length > 0
  return <section aria-label="终端撰写面板" className="mx-2 mb-2 flex max-h-72 flex-shrink-0 flex-col gap-3 rounded-xl border border-border bg-background p-3 shadow-sm">
    <header className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2"><PenLine className="size-4 text-primary" />
        <div><h2 className="text-sm font-medium">撰写终端内容</h2><p className="text-xs text-muted-foreground">组织多行命令，执行或仅粘贴到当前终端</p></div>
      </div>
      <Button type="button" size="icon-xs" variant="ghost" aria-label="关闭撰写面板" onClick={props.onClose}><X /></Button>
    </header>
    <div className="flex min-h-6 items-start gap-2"><span className="pt-1 text-xs font-medium text-muted-foreground">宏</span>
      <MacroList state={props.macros} busy={props.busy} onExecute={props.onExecuteMacro} onRetry={props.onRetry} />
    </div>
    <Field>
      <FieldLabel htmlFor="terminal-compose-input" className="sr-only">撰写终端内容</FieldLabel>
      <Textarea id="terminal-compose-input" ref={props.inputRef} autoFocus value={props.content} disabled={props.busy}
        aria-label="撰写终端内容" placeholder="输入要发送到终端的内容…" className="min-h-20 max-h-36 resize-y font-mono text-sm"
        onChange={(event) => props.onChange(event.target.value)} onKeyDown={props.onKeyDown} />
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">Ctrl/⌘ + Enter 执行</span>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" disabled={!hasContent || props.busy} onClick={props.onPaste}><ClipboardPaste data-icon="inline-start" />粘贴</Button>
          <Button type="button" size="sm" disabled={!hasContent || props.busy} onClick={props.onExecute}>
            {props.busy ? <Spinner data-icon="inline-start" /> : <Play data-icon="inline-start" />}执行
          </Button>
        </div>
      </div>
    </Field>
  </section>
}

export function TerminalComposePanel({ open, terminalID, sessionID, onClose }: Props) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [content, setContent] = useState('')
  const macros = useMacroCatalog(open)
  const { busy, run } = useAsyncGate()
  const execute = useCallback(async () => {
    if (!content.trim()) return
    await run(async () => {
      await TerminalService.Write(terminalID, commandWithEnter(content))
      recordCommand(sessionID, content)
      setContent('')
      window.setTimeout(() => inputRef.current?.focus(), 0)
    }, '执行失败')
  }, [content, run, sessionID, terminalID])
  const paste = useCallback(() => {
    const terminal = useAppStore.getState().terminalPool.get(terminalID)?.terminal
    if (!terminal) return toast('当前终端不可用', 'error')
    terminal.paste(content)
    terminal.focus()
  }, [content, terminalID])
  const executeMacro = useCallback((macro: MacroItem) => run(async () => {
    await MacroService.Execute(terminalID, commandWithEnter(macro.command))
    recordCommand(sessionID, macro.command)
    useAppStore.getState().terminalPool.get(terminalID)?.terminal.focus()
  }, '宏执行失败'), [run, sessionID, terminalID])
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation()
    if (!(event.ctrlKey || event.metaKey) || event.key !== 'Enter') return
    event.preventDefault()
    void execute()
  }
  if (!open) return null
  return <ComposePanelView busy={busy} content={content} inputRef={inputRef} macros={macros.state}
    onChange={setContent} onClose={onClose} onExecute={() => { void execute() }} onExecuteMacro={(macro) => { void executeMacro(macro) }}
    onKeyDown={onKeyDown} onPaste={paste} onRetry={() => { void macros.load() }} />
}
