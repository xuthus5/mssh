import { useEffect, useMemo, useState } from 'react'
import { Events } from '@wailsio/runtime'
import { AIService } from '@/lib/wails'
import { useToolPanelResize } from '@/hooks/useToolPanelResize'
import { useAppStore } from '@/store/appStore'
import { captureTerminalContext } from '@/components/terminal/terminalAIContext'
import { useAITerminalRuntime, type AITerminalRuntime } from '@/components/terminal/aiTerminalRuntime'
import type { AIConversation, AISettingsDashboard } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { t } from '@/i18n'
import type { Terminal } from '@xterm/xterm'
import { executeAutoCommands, type AIPanelMessage } from '@/components/terminal/AIMessageViews'
import {
  emitAIConversationChanged,
  runAIConversationMutation,
  useAIConversationMutationState,
} from '@/lib/aiConversationMutationCoordinator'
import {
  mapAIConversationMessages,
  refreshAIConversationList,
  useAIConversationSync,
} from '@/components/terminal/useAIConversationSync'
import { AI_CONFIGURATION_CHANGED_EVENT } from '@/lib/settingsWindowEvents'
import { AITerminalPanelContent } from '@/components/terminal/AITerminalPanelView'

export interface AITerminalPanelProps {
  open?: boolean
  terminalID: string
  sessionID: number
  onClose: () => void
}

function useAIPanelState() {
  const [dashboard, setDashboard] = useState<AISettingsDashboard | null>(null)
  const [messages, setMessages] = useState<AIPanelMessage[]>([])
  const [conversations, setConversations] = useState<AIConversation[]>([])
  const [conversationID, setConversationID] = useState(0)
  const [prompt, setPrompt] = useState('')
  const [useSearch, setUseSearch] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  return {
    dashboard, setDashboard, messages, setMessages, conversations, setConversations,
    conversationID, setConversationID, prompt, setPrompt, useSearch, setUseSearch,
    pending, setPending, error, setError, historyOpen, setHistoryOpen,
  }
}
type AIPanelState = ReturnType<typeof useAIPanelState>
type AIPanelTargetOptions = { sessionID: number; terminalID: string; state: AIPanelState; runtime: AITerminalRuntime }
type AIDashboardState = Pick<AIPanelState, 'setDashboard' | 'setError' | 'setUseSearch'>
interface AIDashboardLoadOptions {
  state: AIDashboardState
  runtime: AITerminalRuntime
  generation: number
  request: number
}
function applyAIDashboard(state: AIDashboardState, dashboard: AISettingsDashboard) {
  state.setDashboard(dashboard)
  const search = dashboard.settings.search
  if (!search.enabled || search.mode === 'disabled') state.setUseSearch(false)
}
async function loadAIPanel({ targetSessionID, generation, request, dashboardRequest, catalogRequest, state, runtime }: {
  targetSessionID: number
  generation: number
  request: number
  dashboardRequest: number
  catalogRequest: number
  state: AIPanelState
  runtime: AITerminalRuntime
}) {
  const [dashboardResult, historyResult] = await Promise.allSettled([
    AIService.Dashboard(), AIService.ListConversations(targetSessionID, 20),
  ])
  if (!runtime.isCurrent(generation)) return
  const panelCurrent = request === runtime.panelRequest.current
  const dashboardCurrent = dashboardRequest === runtime.dashboardRequest.current
  const catalogCurrent = panelCurrent && catalogRequest === runtime.catalogRequest.current
  if (dashboardCurrent && dashboardResult.status === 'fulfilled') applyAIDashboard(state, dashboardResult.value)
  if (catalogCurrent && historyResult.status === 'fulfilled') state.setConversations(historyResult.value ?? [])
  const failure = dashboardCurrent && dashboardResult.status === 'rejected'
    ? dashboardResult.reason
    : catalogCurrent && historyResult.status === 'rejected' ? historyResult.reason : null
  if (failure) state.setError(t('加载 AI 面板失败: ${}', errorMessage(failure)))
  else if (dashboardCurrent || catalogCurrent) state.setError('')
}
async function loadAIDashboard({ state, runtime, generation, request }: AIDashboardLoadOptions) {
  try {
    const dashboard = await AIService.Dashboard()
    if (!runtime.isCurrent(generation) || request !== runtime.dashboardRequest.current) return
    applyAIDashboard(state, dashboard)
  } catch (error) {
    if (!runtime.isCurrent(generation) || request !== runtime.dashboardRequest.current) return
    state.setError(t('刷新 AI 配置失败: ${}', errorMessage(error)))
  }
}
function useAIConfigurationReload(state: AIPanelState, runtime: AITerminalRuntime) {
  const { setDashboard, setError, setUseSearch } = state
  useEffect(() => Events.On(AI_CONFIGURATION_CHANGED_EVENT, () => {
    const generation = runtime.targetGeneration.current
    const request = ++runtime.dashboardRequest.current
    void loadAIDashboard({ state: { setDashboard, setError, setUseSearch }, runtime, generation, request })
  }), [runtime, setDashboard, setError, setUseSearch])
}
function useAIPanelTarget({ sessionID, terminalID, state, runtime }: AIPanelTargetOptions) {
  useEffect(() => {
    const generation = ++runtime.targetGeneration.current
    runtime.panelRequest.current++
    runtime.dashboardRequest.current++
    runtime.catalogRequest.current++
    runtime.historyRequest.current++
    state.setConversations([])
    state.setMessages([])
    state.setConversationID(0)
    state.setPrompt('')
    state.setError('')
    state.setHistoryOpen(false)
    void loadAIPanel({
      targetSessionID: sessionID, generation, request: runtime.panelRequest.current,
      dashboardRequest: runtime.dashboardRequest.current, catalogRequest: runtime.catalogRequest.current, state, runtime,
    })
    return () => {
      if (runtime.targetGeneration.current === generation) runtime.targetGeneration.current++
    }
  }, [sessionID, terminalID])
}

interface AIPanelActionContext {
  props: AITerminalPanelProps
  state: AIPanelState
  runtime: AITerminalRuntime
  terminal: Terminal | undefined
  contextLines: number
  maxOutputBytes: number
  searchEnabled: boolean
}
async function refreshConversationsAfterChat(context: AIPanelActionContext, generation: number, isCurrent: () => boolean) {
  try {
    await refreshAIConversationList({
      sessionID: context.props.sessionID, generation, runtime: context.runtime,
      setConversations: context.state.setConversations,
    })
  } catch (error) {
    if (isCurrent()) context.state.setError(t('刷新 AI 对话历史失败: ${}', errorMessage(error)))
  }
}
async function performAIChat(context: AIPanelActionContext, text: string, isRequestCurrent: () => boolean) {
  const { props, state, runtime } = context
  const generation = runtime.targetGeneration.current
  const historyRequest = ++runtime.historyRequest.current
  const isDisplayCurrent = () => isRequestCurrent() && historyRequest === runtime.historyRequest.current
  state.setPrompt(''); state.setPending(true); state.setError('')
  state.setMessages((current) => [...current, { id: `user-${Date.now()}`, role: 'user', content: text }])
  const response = await AIService.Chat({
    conversation_id: state.conversationID, session_id: props.sessionID, terminal_id: props.terminalID,
    prompt: text, terminal_context: captureTerminalContext(context.terminal, context.contextLines, context.maxOutputBytes),
    use_search: state.useSearch && context.searchEnabled,
  })
  emitAIConversationChanged(props.sessionID, response.conversation_id, runtime.source)
  if (!isDisplayCurrent()) {
    if (isRequestCurrent()) await refreshConversationsAfterChat(context, generation, isRequestCurrent)
    return
  }
  state.setConversationID(response.conversation_id)
  let autoExecuted: string[] = []
  try {
    autoExecuted = await executeAutoCommands({
      commands: response.commands, conversationID: response.conversation_id,
      sessionID: props.sessionID, terminalID: props.terminalID,
      shouldContinue: isDisplayCurrent,
    })
  } catch (executionError) {
    if (!isDisplayCurrent()) {
      if (isRequestCurrent()) await refreshConversationsAfterChat(context, generation, isRequestCurrent)
      return
    }
    state.setError(t('只读命令自动执行失败: ${}', errorMessage(executionError)))
  }
  if (!isDisplayCurrent()) {
    if (isRequestCurrent()) await refreshConversationsAfterChat(context, generation, isRequestCurrent)
    return
  }
  state.setMessages((current) => [...current, {
    id: `assistant-${Date.now()}`, role: 'assistant', content: response.answer,
    commands: response.commands, citations: response.citations, autoExecuted,
  }])
  await refreshConversationsAfterChat(context, generation, isRequestCurrent)
}
async function sendAIMessage(context: AIPanelActionContext) {
  const { state, runtime } = context
  if (!state.prompt.trim() || runtime.sendActive.current) return
  const text = state.prompt.trim()
  const conversationID = state.conversationID
  runtime.sendActive.current = true
  const lifecycleToken = runtime.lifecycle.current
  const generation = runtime.targetGeneration.current
  const request = ++runtime.sendRequest.current
  const isRequestCurrent = () => runtime.lifecycle.current === lifecycleToken
    && runtime.isCurrent(generation) && request === runtime.sendRequest.current
  const isLatest = () => runtime.lifecycle.current === lifecycleToken && request === runtime.sendRequest.current
  try {
    await runAIConversationMutation(conversationID, () => performAIChat(context, text, isRequestCurrent))
  } catch (sendError) {
    if (isRequestCurrent()) state.setError(errorMessage(sendError))
  } finally {
    if (isLatest()) {
      runtime.sendActive.current = false
      state.setPending(false)
    }
  }
}
async function loadAIConversation(id: number, state: AIPanelState, runtime: AITerminalRuntime) {
    const generation = runtime.targetGeneration.current
    const request = ++runtime.historyRequest.current
    try {
      const items = await AIService.ListMessages(id)
      if (!runtime.isCurrent(generation) || request !== runtime.historyRequest.current) return
      state.setConversationID(id)
      state.setMessages(mapAIConversationMessages(items))
      state.setHistoryOpen(false)
    } catch (loadError) {
      if (runtime.isCurrent(generation) && request === runtime.historyRequest.current) state.setError(errorMessage(loadError))
    }
}

function useAITerminalController(props: AITerminalPanelProps) {
  const state = useAIPanelState()
  const runtime = useAITerminalRuntime()
  useAIPanelTarget({ sessionID: props.sessionID, terminalID: props.terminalID, state, runtime })
  useAIConfigurationReload(state, runtime)
  useAIConversationSync({
    sessionID: props.sessionID, conversationID: state.conversationID, runtime,
    setConversations: state.setConversations, setMessages: state.setMessages, setError: state.setError,
  })
  const terminal = useAppStore((store) => store.terminalPool.get(props.terminalID)?.terminal)
  const contextLines = state.dashboard?.settings.interaction.context_lines ?? 80
  const maxOutputBytes = state.dashboard?.settings.security.max_output_bytes ?? 65536
  const autoScroll = state.dashboard?.settings.interaction.auto_scroll ?? true
  const searchEnabled = state.dashboard?.settings.search.enabled === true && state.dashboard.settings.search.mode !== 'disabled'
  const conversationBusy = useAIConversationMutationState((current) => (
    state.conversationID > 0 && current.busyConversationIDs.has(state.conversationID)
  ))
  const canSend = useMemo(() => (
    state.prompt.trim().length > 0 && !state.pending && !conversationBusy
  ), [conversationBusy, state.pending, state.prompt])
  const refreshPanel = () => {
    const request = ++runtime.panelRequest.current
    const dashboardRequest = ++runtime.dashboardRequest.current
    const catalogRequest = ++runtime.catalogRequest.current
    void loadAIPanel({
      targetSessionID: props.sessionID, generation: runtime.targetGeneration.current,
      request, dashboardRequest, catalogRequest, state, runtime,
    })
  }
  const actionContext = { props, state, runtime, terminal, contextLines, maxOutputBytes, searchEnabled }
  return { state, canSend, conversationBusy, contextLines, autoScroll, searchEnabled, refreshPanel, send: () => sendAIMessage(actionContext), loadConversation: (id: number) => loadAIConversation(id, state, runtime) }
}

export type AITerminalController = ReturnType<typeof useAITerminalController>

export function AITerminalPanel(props: AITerminalPanelProps) {
  const panel = useToolPanelResize('ai')
  const controller = useAITerminalController(props)
  return <aside hidden={props.open === false} style={panel.panelStyle} className="absolute inset-y-0 right-0 z-20 flex min-w-0 flex-col border-l border-border bg-card shadow-xl" data-testid="ai-terminal-panel">
    <div {...panel.resizeHandleProps} className="absolute inset-y-0 -left-1 z-30 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent hover:after:bg-primary/60 focus-visible:after:bg-primary active:after:bg-primary" />
    <AITerminalPanelContent controller={controller} props={props} />
  </aside>
}

function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error) }
