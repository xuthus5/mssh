import { useEffect } from 'react'
import { t } from '@/i18n'
import { AIService } from '@/lib/wails'
import { onAIConversationChanged } from '@/lib/aiConversationMutationCoordinator'
import type { AITerminalRuntime } from '@/components/terminal/aiTerminalRuntime'
import type { AIPanelMessage } from '@/components/terminal/AIMessageViews'
import type { AIConversation, AIMessage } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

interface AIConversationSyncOptions {
  sessionID: number
  conversationID: number
  runtime: AITerminalRuntime
  setConversations: (conversations: AIConversation[]) => void
  setMessages: (messages: AIPanelMessage[]) => void
  setError: (error: string) => void
}

export function mapAIConversationMessages(items: AIMessage[] | null | undefined): AIPanelMessage[] {
  return (items ?? []).filter((item) => item.role === 'user' || item.role === 'assistant')
    .map((item) => ({ id: String(item.id), role: item.role as AIPanelMessage['role'], content: item.content }))
}

export async function refreshAIConversationList(options: {
  sessionID: number
  generation: number
  runtime: AITerminalRuntime
  setConversations: (conversations: AIConversation[]) => void
}) {
  const request = ++options.runtime.catalogRequest.current
  const conversations = await AIService.ListConversations(options.sessionID, 20)
  if (options.runtime.isCurrent(options.generation) && request === options.runtime.catalogRequest.current) {
    options.setConversations(conversations ?? [])
  }
}

async function syncConversation(options: AIConversationSyncOptions, changedConversationID: number) {
  const generation = options.runtime.targetGeneration.current
  const catalogRequest = ++options.runtime.catalogRequest.current
  const reloadMessages = options.conversationID > 0 && options.conversationID === changedConversationID
  const historyRequest = reloadMessages ? ++options.runtime.historyRequest.current : 0
  const messageTask = reloadMessages
    ? AIService.ListMessages(changedConversationID)
    : Promise.resolve<AIMessage[] | null>(null)
  const [catalogResult, messageResult] = await Promise.allSettled([
    AIService.ListConversations(options.sessionID, 20), messageTask,
  ])
  if (!options.runtime.isCurrent(generation)) return
  const failures: unknown[] = []
  const catalogCurrent = catalogRequest === options.runtime.catalogRequest.current
  if (catalogCurrent) {
    if (catalogResult.status === 'fulfilled') options.setConversations(catalogResult.value ?? [])
    else failures.push(catalogResult.reason)
  }
  const historyCurrent = reloadMessages && historyRequest === options.runtime.historyRequest.current
  if (historyCurrent) {
    if (messageResult.status === 'fulfilled') options.setMessages(mapAIConversationMessages(messageResult.value))
    else failures.push(messageResult.reason)
  }
  if (failures.length > 0) {
    const error = failures[0]
    options.setError(t('同步 AI 对话失败: ${}', error instanceof Error ? error.message : String(error)))
  } else if (catalogCurrent || historyCurrent) options.setError('')
}

export function useAIConversationSync(options: AIConversationSyncOptions) {
  const { sessionID, conversationID, runtime, setConversations, setMessages, setError } = options
  useEffect(() => onAIConversationChanged(sessionID, runtime.source, (changedConversationID) => {
    void syncConversation({ sessionID, conversationID, runtime, setConversations, setMessages, setError }, changedConversationID)
  }), [conversationID, runtime, sessionID, setConversations, setError, setMessages])
}
