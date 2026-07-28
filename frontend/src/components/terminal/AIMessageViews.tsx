import { useEffect, useRef, useState } from 'react'
import { Browser } from '@wailsio/runtime'
import { Check, ExternalLink, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { t } from '@/i18n'
import { normalizeExternalHTTPURL } from '@/lib/externalURL'
import { cn } from '@/lib/utils'
import { AIService } from '@/lib/wails'
import type { AICommandProposal, AICitation } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

export type AIPanelMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  commands?: AICommandProposal[]
  citations?: AICitation[]
  autoExecuted?: string[]
}

export function AIMessageView({ message, sessionID, terminalID, conversationID }: {
  message: AIPanelMessage
  sessionID: number
  terminalID: string
  conversationID: number
}) {
  return <div className={cn('flex flex-col gap-2 rounded-lg border p-3 text-sm', message.role === 'user' ? 'border-primary/20 bg-primary/5' : 'border-border bg-background/50')}>
    <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">{message.role === 'user' ? t('你') : 'AI'}</div>
    <div className="whitespace-pre-wrap break-words text-sm">{message.content}</div>
    {message.commands?.map((command) => <CommandProposal key={command.command} command={command} sessionID={sessionID} terminalID={terminalID} conversationID={conversationID} initiallyExecuted={message.autoExecuted?.includes(command.command) ?? false} />)}
    {message.citations && message.citations.length > 0 && <CitationList citations={message.citations} />}
  </div>
}

function CitationList({ citations }: { citations: AICitation[] }) {
  return <div className="flex flex-col gap-1 border-t pt-2 text-xs text-muted-foreground">
    {citations.map((citation, index) => <CitationLink key={`${citation.url}:${index}`} citation={citation} />)}
  </div>
}

function CitationLink({ citation }: { citation: AICitation }) {
  const normalizedURL = normalizeExternalHTTPURL(citation.url)
  const hostname = normalizedURL ? new URL(normalizedURL).hostname : ''
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')
  const lifecycle = useRef(0)
  const requestID = useRef(0)
  const active = useRef(false)

  useEffect(() => {
    const token = ++lifecycle.current
    requestID.current++
    active.current = false
    setOpening(false)
    setError('')
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [citation.title, citation.url])

  if (!normalizedURL) return <BlockedCitation citation={citation} />

  const open = async () => {
    if (active.current) return
    active.current = true
    const lifecycleToken = lifecycle.current
    const request = ++requestID.current
    const isCurrent = () => lifecycle.current === lifecycleToken && requestID.current === request
    setOpening(true)
    setError('')
    try {
      await Browser.OpenURL(normalizedURL)
    } catch (openError) {
      if (isCurrent()) setError(t('打开引用链接失败: ${}', errorMessage(openError)))
    } finally {
      if (isCurrent()) { active.current = false; setOpening(false) }
    }
  }

  return <div className="flex min-w-0 flex-col gap-1">
    <div className="flex min-w-0 items-center gap-2">
      <Button variant="link" size="xs" className="h-auto min-w-0 flex-1 justify-start px-0 py-0 text-xs" disabled={opening} onClick={() => { void open() }}>
        <ExternalLink data-icon="inline-start" />
        <span className="truncate">{citation.title || hostname}</span>
      </Button>
      <span className="max-w-36 shrink-0 truncate font-mono text-[10px]" title={hostname}>{hostname}</span>
    </div>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>
}

function BlockedCitation({ citation }: { citation: AICitation }) {
  const label = citation.title || citation.url
  return <div className="flex min-w-0 items-center gap-1 py-0.5 text-muted-foreground" title={t('引用链接已被安全策略阻止')}>
    <ShieldAlert className="size-3 shrink-0" />
    <span className="truncate">{label}</span>
  </div>
}

function CommandProposal({ command, sessionID, terminalID, conversationID, initiallyExecuted }: {
  command: AICommandProposal
  sessionID: number
  terminalID: string
  conversationID: number
  initiallyExecuted: boolean
}) {
  const [executed, setExecuted] = useState(initiallyExecuted)
  const [executing, setExecuting] = useState(false)
  const [error, setError] = useState('')
  const lifecycle = useRef(0)
  const requestID = useRef(0)
  const active = useRef(false)
  const targetKey = `${conversationID}:${sessionID}:${terminalID}:${command.command}`
  useEffect(() => {
    const token = ++lifecycle.current
    requestID.current++
    active.current = false
    setExecuted(initiallyExecuted)
    setExecuting(false)
    setError('')
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [initiallyExecuted, targetKey])
  const blocked = command.blocked || command.risk === 'blocked'
  const execute = async () => {
    if (blocked || executed || active.current) return
    active.current = true
    const lifecycleToken = lifecycle.current
    const request = ++requestID.current
    const isCurrent = () => lifecycle.current === lifecycleToken && requestID.current === request
    setExecuting(true)
    setError('')
    try {
      await AIService.ExecuteCommand({ conversation_id: conversationID, session_id: sessionID, terminal_id: terminalID, command: command.command, approved: true })
      if (isCurrent()) setExecuted(true)
    } catch (executionError) {
      if (isCurrent()) setError(errorMessage(executionError))
    } finally {
      if (isCurrent()) { active.current = false; setExecuting(false) }
    }
  }
  return <Card className="border-border bg-background"><CardContent className="flex flex-col gap-2 p-2.5"><div className="flex items-start gap-2"><code className="min-w-0 flex-1 whitespace-pre-wrap break-all text-xs">{command.command}</code>{blocked ? <ShieldAlert className="size-4 shrink-0 text-destructive" /> : executed ? <Check className="size-4 shrink-0 text-emerald-600" /> : <Button size="xs" disabled={executing} onClick={() => { void execute() }}>{executing ? t('执行中...') : t('审批并执行')}</Button>}</div><p className="text-xs text-muted-foreground">{command.purpose || t('模型建议命令')} · {riskLabel(command.risk)}</p>{error && <p className="text-xs text-destructive">{error}</p>}{blocked && <p className="text-xs text-destructive">{command.blocked_reason || t('命令被安全策略阻断')}</p>}</CardContent></Card>
}

function riskLabel(risk: string) {
  return ({ read_only: t('只读'), modify: t('修改'), high: t('高风险'), blocked: t('已阻断') } as Record<string, string>)[risk] ?? risk
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export async function executeAutoCommands({ commands, conversationID, sessionID, terminalID, shouldContinue }: {
  commands: AICommandProposal[]
  conversationID: number
  sessionID: number
  terminalID: string
  shouldContinue: () => boolean
}): Promise<string[]> {
  const executed: string[] = []
  for (const command of commands) {
    if (!command.can_auto_execute || command.blocked) continue
    if (!shouldContinue()) return executed
    await AIService.ExecuteCommand({ conversation_id: conversationID, session_id: sessionID, terminal_id: terminalID, command: command.command, approved: false })
    executed.push(command.command)
  }
  return executed
}
