import { Bot, History, Send, X } from 'lucide-react'
import { AIMessageView } from '@/components/terminal/AIMessageViews'
import { useAIMessageAutoScroll } from '@/components/terminal/useAIMessageAutoScroll'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { t } from '@/i18n'
import type { AITerminalController, AITerminalPanelProps } from '@/components/terminal/AITerminalPanel'

interface AITerminalPanelContentProps {
  controller: AITerminalController
  props: AITerminalPanelProps
}

export function AITerminalPanelContent({ controller, props }: AITerminalPanelContentProps) {
  return <>
    <AIPanelHeader controller={controller} onClose={props.onClose} />
    <AIConversationHistory controller={controller} />
    <AIMessageList controller={controller} props={props} />
    <AIComposer controller={controller} />
  </>
}

function AIPanelHeader({ controller, onClose }: { controller: AITerminalController; onClose: () => void }) {
  return <header className="flex items-center justify-between border-b border-border px-3 py-2">
    <span className="flex items-center gap-2 text-sm font-semibold"><Bot className="size-4 text-primary" />{t('AI 运维')}</span>
    <span className="flex items-center gap-1">
      <Button size="icon-xs" variant={controller.state.historyOpen ? 'secondary' : 'ghost'} aria-label={t('对话历史')} onClick={() => controller.state.setHistoryOpen((value) => !value)}><History /></Button>
      <Button size="icon-xs" variant="ghost" aria-label={t('关闭 AI 面板')} onClick={onClose}><X /></Button>
    </span>
  </header>
}

function AIConversationHistory({ controller }: { controller: AITerminalController }) {
  if (!controller.state.historyOpen) return null
  const { conversations, error } = controller.state
  if (error && conversations.length === 0) return <div className="max-h-48 border-b border-border p-2">
    <div className="flex flex-col gap-2 p-2 text-xs text-destructive" role="alert"><p>{error}</p><Button size="xs" variant="outline" onClick={controller.refreshPanel}>{t('重试')}</Button></div>
  </div>
  return <div className="max-h-48 overflow-y-auto border-b border-border p-2">
    {conversations.length === 0 ? <p className="p-2 text-xs text-muted-foreground">{t('暂无对话')}</p>
      : conversations.map((conversation) => <button type="button" key={conversation.id} className="block w-full truncate rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted" onClick={() => { void controller.loadConversation(conversation.id) }}>{conversation.title}</button>)}
  </div>
}

function AIMessageList({ controller, props }: AITerminalPanelContentProps) {
  const { messages, pending, error, conversationID } = controller.state
  const endRef = useAIMessageAutoScroll({
    enabled: controller.autoScroll, visible: props.open !== false,
    hasContent: messages.length > 0 || pending,
    contentVersion: `${messages.length}:${pending}`,
  })
  return <div className="min-h-0 flex flex-1 flex-col gap-3 overflow-y-auto p-3">
    {messages.length === 0 ? <div className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">{t('从当前终端上下文开始提问。模型不会自动执行命令，命令必须逐条审批。')}</div> : null}
    {messages.map((message) => <AIMessageView key={message.id} message={message} sessionID={props.sessionID} terminalID={props.terminalID} conversationID={conversationID} />)}
    {pending ? <p className="text-xs text-muted-foreground">{t('AI 正在分析当前上下文...')}</p> : null}
    {error ? <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</p> : null}
    <div ref={endRef} aria-hidden="true" />
  </div>
}

function AIComposer({ controller }: { controller: AITerminalController }) {
  const { prompt, useSearch } = controller.state
  return <div className="border-t border-border p-3">
    <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
      <label className="flex items-center gap-2"><Switch checked={useSearch && controller.searchEnabled} disabled={!controller.searchEnabled} onCheckedChange={controller.state.setUseSearch} />{t('网络搜索')}</label>
      <span>{controller.contextLines} {t('行上下文')}</span>
    </div>
    {controller.conversationBusy ? <p role="status" className="mb-2 text-xs text-muted-foreground">{t('AI 对话正在处理另一条消息')}</p> : null}
    <div className="flex items-end gap-2">
      <Textarea value={prompt} onChange={(event) => controller.state.setPrompt(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void controller.send() }}
        placeholder={t('描述要排查或执行的运维任务')} rows={3} />
      <Button size="icon" disabled={!controller.canSend} aria-label={t('发送问题')} onClick={() => { void controller.send() }}><Send /></Button>
    </div>
  </div>
}
