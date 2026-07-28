import { create } from 'zustand'
import { t } from '@/i18n'
import { OperationBusyError } from '@/lib/operationBusyError'

interface AIConversationMutationState {
  busyConversationIDs: ReadonlySet<number>
}

interface AIConversationChange {
  sessionID: number
  conversationID: number
  source: symbol
}

const aiConversationChangedEvent = 'mssh:ai-conversation-changed'
const activeConversationIDs = new Set<number>()

export const useAIConversationMutationState = create<AIConversationMutationState>(() => ({
  busyConversationIDs: new Set(),
}))

function publishMutationState() {
  useAIConversationMutationState.setState({ busyConversationIDs: new Set(activeConversationIDs) })
}

export async function runAIConversationMutation<T>(conversationID: number, operation: () => Promise<T>): Promise<T> {
  if (conversationID <= 0) return operation()
  if (activeConversationIDs.has(conversationID)) {
    throw new OperationBusyError(t('AI 对话正在处理另一条消息'))
  }
  activeConversationIDs.add(conversationID)
  publishMutationState()
  try {
    return await operation()
  } finally {
    activeConversationIDs.delete(conversationID)
    publishMutationState()
  }
}

export function emitAIConversationChanged(sessionID: number, conversationID: number, source: symbol) {
  const detail: AIConversationChange = { sessionID, conversationID, source }
  window.dispatchEvent(new CustomEvent<AIConversationChange>(aiConversationChangedEvent, { detail }))
}

export function onAIConversationChanged(
  sessionID: number,
  source: symbol,
  handler: (conversationID: number) => void,
) {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<AIConversationChange>).detail
    if (detail?.sessionID === sessionID && detail.source !== source) handler(detail.conversationID)
  }
  window.addEventListener(aiConversationChangedEvent, listener)
  return () => window.removeEventListener(aiConversationChangedEvent, listener)
}

export function resetAIConversationMutationCoordinator() {
  activeConversationIDs.clear()
  publishMutationState()
}
