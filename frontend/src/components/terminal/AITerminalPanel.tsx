import { useEffect, useMemo, useState } from 'react'
import { Bot, Check, ExternalLink, History, Send, ShieldAlert, X } from 'lucide-react'
import { AIService } from '@/lib/wails'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useToolPanelResize } from '@/hooks/useToolPanelResize'
import { useAppStore } from '@/store/appStore'
import { captureTerminalContext } from '@/components/terminal/terminalAIContext'
import type { AICommandProposal, AICitation, AIConversation, AISettingsDashboard } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { t } from '@/i18n'


type Message = { id: string; role: 'user' | 'assistant'; content: string; commands?: AICommandProposal[]; citations?: AICitation[]; autoExecuted?: string[] }

export function AITerminalPanel({ terminalID, sessionID, onClose }: { terminalID: string; sessionID: number; onClose: () => void }) {
  const panel = useToolPanelResize('ai')
  const [dashboard, setDashboard] = useState<AISettingsDashboard | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [conversations, setConversations] = useState<AIConversation[]>([])
  const [conversationID, setConversationID] = useState(0)
  const [prompt, setPrompt] = useState('')
  const [useSearch, setUseSearch] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  useEffect(() => { void loadPanel() }, [sessionID])
  const contextLines = dashboard?.settings.interaction.context_lines ?? 80
  const terminal = useAppStore((state) => state.terminalPool.get(terminalID)?.terminal)
  const canSend = useMemo(() => prompt.trim().length > 0 && !pending, [pending, prompt])
  async function loadPanel() {
    try { const [nextDashboard, history] = await Promise.all([AIService.Dashboard(), AIService.ListConversations(sessionID, 20)]); setDashboard(nextDashboard); setConversations(history ?? []); setError('') }
    catch (loadError) { setError(errorMessage(loadError)) }
  }
  async function send() {
    if (!canSend) return
    const text = prompt.trim()
    setPrompt(''); setPending(true); setError('')
    setMessages((current) => [...current, { id: `user-${Date.now()}`, role: 'user', content: text }])
    try {
      const response = await AIService.Chat({ conversation_id: conversationID, session_id: sessionID, terminal_id: terminalID, prompt: text, terminal_context: captureTerminalContext(terminal, contextLines), use_search: useSearch })
      setConversationID(response.conversation_id)
      let autoExecuted: string[] = []
      try { autoExecuted = await executeAutoCommands(response.commands, response.conversation_id, sessionID, terminalID) }
      catch (executionError) { setError(t('只读命令自动执行失败: ${}', errorMessage(executionError))) }
      setMessages((current) => [...current, { id: `assistant-${Date.now()}`, role: 'assistant', content: response.answer, commands: response.commands, citations: response.citations, autoExecuted }])
      setConversations(await AIService.ListConversations(sessionID, 20))
    } catch (sendError) { setError(errorMessage(sendError)) }
    finally { setPending(false) }
  }
  async function loadConversation(id: number) {
    try { const items = await AIService.ListMessages(id); setConversationID(id); setMessages((items ?? []).filter((item) => item.role === 'user' || item.role === 'assistant').map((item) => ({ id: String(item.id), role: item.role as Message['role'], content: item.content }))); setHistoryOpen(false) }
    catch (loadError) { setError(errorMessage(loadError)) }
  }
  return <aside style={panel.panelStyle} className="absolute inset-y-0 right-0 z-20 flex min-w-0 flex-col border-l border-border bg-card shadow-xl" data-testid="ai-terminal-panel"><div {...panel.resizeHandleProps} className="absolute inset-y-0 -left-1 z-30 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent hover:after:bg-primary/60 focus-visible:after:bg-primary active:after:bg-primary" /><header className="flex items-center justify-between border-b border-border px-3 py-2"><span className="flex items-center gap-2 text-sm font-semibold"><Bot className="size-4 text-primary" />{t('AI 运维')}</span><span className="flex items-center gap-1"><Button size="icon-xs" variant={historyOpen ? 'secondary' : 'ghost'} aria-label={t('对话历史')} onClick={() => setHistoryOpen((value) => !value)}><History /></Button><Button size="icon-xs" variant="ghost" aria-label={t('关闭 AI 面板')} onClick={onClose}><X /></Button></span></header>{historyOpen && <div className="max-h-48 overflow-y-auto border-b border-border p-2">{conversations.length === 0 ? <p className="p-2 text-xs text-muted-foreground">{t('暂无对话')}</p> : conversations.map((conversation) => <button type="button" key={conversation.id} className="block w-full truncate rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted" onClick={() => void loadConversation(conversation.id)}>{conversation.title}</button>)}</div>}<div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">{messages.length === 0 && <div className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">{t('从当前终端上下文开始提问。模型不会自动执行命令，命令必须逐条审批。')}</div>}{messages.map((message) => <MessageView key={message.id} message={message} sessionID={sessionID} terminalID={terminalID} conversationID={conversationID} />)}{pending && <p className="text-xs text-muted-foreground">{t('AI 正在分析当前上下文...')}</p>}{error && <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}</div><div className="border-t border-border p-3"><div className="mb-2 flex items-center justify-between text-xs text-muted-foreground"><label className="flex items-center gap-2"><Switch checked={useSearch} onCheckedChange={setUseSearch} />{t('网络搜索')}</label><span>{contextLines} {t('行上下文')}</span></div><div className="flex items-end gap-2"><Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void send() }} placeholder={t('描述要排查或执行的运维任务')} rows={3} /><Button size="icon" disabled={!canSend} aria-label={t('发送问题')} onClick={() => void send()}><Send /></Button></div></div></aside>
}

function MessageView({ message, sessionID, terminalID, conversationID }: { message: Message; sessionID: number; terminalID: string; conversationID: number }) {
  return <div className={`space-y-2 rounded-lg border p-3 text-sm ${message.role === 'user' ? 'border-primary/20 bg-primary/5' : 'border-border bg-background/50'}`}><div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">{message.role === 'user' ? t('你') : 'AI'}</div><div className="whitespace-pre-wrap break-words text-sm">{message.content}</div>{message.commands?.map((command) => <CommandProposal key={command.command} command={command} sessionID={sessionID} terminalID={terminalID} conversationID={conversationID} initiallyExecuted={message.autoExecuted?.includes(command.command) ?? false} />)}{message.citations && message.citations.length > 0 && <div className="border-t pt-2 text-xs text-muted-foreground">{message.citations.map((citation) => <a key={citation.url} href={citation.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 truncate py-0.5 text-primary hover:underline"><ExternalLink className="size-3" />{citation.title || citation.url}</a>)}</div>}</div>
}

function CommandProposal({ command, sessionID, terminalID, conversationID, initiallyExecuted }: { command: AICommandProposal; sessionID: number; terminalID: string; conversationID: number; initiallyExecuted: boolean }) {
  const [executed, setExecuted] = useState(initiallyExecuted)
  const [error, setError] = useState('')
  const blocked = command.blocked || command.risk === 'blocked'
  const execute = async () => { try { await AIService.ExecuteCommand({ conversation_id: conversationID, session_id: sessionID, terminal_id: terminalID, command: command.command, approved: true }); setExecuted(true); setError('') } catch (executionError) { setError(errorMessage(executionError)) } }
  return <Card className="border-border bg-background"><CardContent className="space-y-2 p-2.5"><div className="flex items-start gap-2"><code className="min-w-0 flex-1 whitespace-pre-wrap break-all text-xs">{command.command}</code>{blocked ? <ShieldAlert className="size-4 shrink-0 text-destructive" /> : executed ? <Check className="size-4 shrink-0 text-emerald-600" /> : <Button size="xs" disabled={blocked} onClick={() => void execute()}>{t('审批并执行')}</Button>}</div><p className="text-xs text-muted-foreground">{command.purpose || t('模型建议命令')} · {riskLabel(command.risk)}</p>{error && <p className="text-xs text-destructive">{error}</p>}{blocked && <p className="text-xs text-destructive">{command.blocked_reason || t('命令被安全策略阻断')}</p>}</CardContent></Card>
}

function riskLabel(risk: string) { return ({ read_only: t('只读'), modify: t('修改'), high: t('高风险'), blocked: t('已阻断') } as Record<string, string>)[risk] ?? risk }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error) }

async function executeAutoCommands(commands: AICommandProposal[], conversationID: number, sessionID: number, terminalID: string): Promise<string[]> {
  const executed: string[] = []
  for (const command of commands) {
    if (!command.can_auto_execute || command.blocked) continue
    await AIService.ExecuteCommand({ conversation_id: conversationID, session_id: sessionID, terminal_id: terminalID, command: command.command, approved: false })
    executed.push(command.command)
  }
  return executed
}
