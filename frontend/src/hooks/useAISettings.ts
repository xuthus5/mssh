import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Events } from '@wailsio/runtime'
import { AIService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import type { AIAgentCLIStatus, AIProviderProfile, AIProviderProfileInput, AISettingsDashboard, AISettingsInput } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { t } from '@/i18n'
import { writeStorageItem } from '@/lib/safeStorage'
import { OperationBusyError } from '@/lib/operationBusyError'
import { AI_CONFIGURATION_CHANGED_EVENT } from '@/lib/settingsWindowEvents'


export interface AISettingsController {
  dashboard: AISettingsDashboard | null
  agents: AIAgentCLIStatus[]
  loading: boolean
  pending: string | null
  error: string | null
  reload: () => Promise<void>
  saveProvider: (input: AIProviderProfileInput) => Promise<AIProviderProfile | null>
  deleteProvider: (id: number) => Promise<void>
  testProvider: (id: number) => Promise<void>
  saveSettings: (input: AISettingsInput, options?: { quiet?: boolean }) => Promise<void>
  detectAgents: () => Promise<void>
}

const failureLabels: Record<string, string> = {
  'provider-save': '保存提供商配置失败: ${}',
  'provider-delete': '删除提供商配置失败: ${}',
  'provider-test': '测试提供商连接失败: ${}',
  settings: '保存 AI 配置失败: ${}',
  agents: '检测 Agent 失败: ${}',
}

function useAISettingsState() {
  const [dashboard, setDashboard] = useState<AISettingsDashboard | null>(null)
  const [agents, setAgents] = useState<AIAgentCLIStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  return { dashboard, setDashboard, agents, setAgents, loading, setLoading, pending, setPending, error, setError }
}

type AISettingsState = ReturnType<typeof useAISettingsState>

function useAISettingsRuntime() {
  const lifecycle = useRef(0)
  const reloadRequest = useRef(0)
  const operationRequest = useRef(0)
  const operationActive = useRef(false)
  const agentRequest = useRef(0)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => {
      if (lifecycle.current === token) lifecycle.current++
    }
  }, [])
  return useMemo(() => ({ lifecycle, reloadRequest, operationRequest, operationActive, agentRequest }), [])
}

type AISettingsRuntime = ReturnType<typeof useAISettingsRuntime>

function emitAIConfigurationChanged() {
  void Events.Emit(AI_CONFIGURATION_CHANGED_EVENT, { changed: true }).catch((error: unknown) => {
    logger.error('emit AI configuration changed failed', error)
  })
}

function useAIReload(state: AISettingsState, runtime: AISettingsRuntime) {
  const { setDashboard, setError, setLoading } = state
  return useCallback(async () => {
    const lifecycleToken = runtime.lifecycle.current
    const request = ++runtime.reloadRequest.current
    try {
      const nextDashboard = await AIService.Dashboard()
      if (runtime.lifecycle.current !== lifecycleToken || runtime.reloadRequest.current !== request) return
      setDashboard(nextDashboard)
      setError(null)
    } catch (loadError) {
      if (runtime.lifecycle.current !== lifecycleToken || runtime.reloadRequest.current !== request) return
      setError(errorMessage(loadError))
      logger.error('load AI settings failed', loadError)
    } finally {
      if (runtime.lifecycle.current === lifecycleToken && runtime.reloadRequest.current === request) setLoading(false)
    }
  }, [runtime, setDashboard, setError, setLoading])
}

interface ExecuteAIAction {
  name: string
  success: string
  action: () => Promise<unknown>
  refresh?: boolean
  quiet?: boolean
}

function useAIExecute(state: AISettingsState, runtime: AISettingsRuntime, reload: () => Promise<void>) {
  const { setError, setPending } = state
  return useCallback(async ({ name, success, action, refresh = true, quiet = false }: ExecuteAIAction) => {
    if (runtime.operationActive.current) throw new OperationBusyError(t('AI 设置操作正在进行'))
    runtime.operationActive.current = true
    const lifecycleToken = runtime.lifecycle.current
    const request = ++runtime.operationRequest.current
    runtime.reloadRequest.current++
    const isCurrent = () => runtime.lifecycle.current === lifecycleToken && runtime.operationRequest.current === request
    setPending(name)
    setError(null)
    try {
      await action()
      if (!isCurrent()) return
      if (refresh) await reload()
      if (isCurrent() && !quiet) toast(success, 'success')
    } catch (actionError) {
      if (!isCurrent()) throw actionError
      const message = errorMessage(actionError)
      const failureKey = failureLabels[name] ?? '${}失败: ${}'
      setError(failureLabels[name] ? t(failureKey, message) : t(failureKey, name, message))
      throw actionError
    } finally {
      if (runtime.operationRequest.current === request) runtime.operationActive.current = false
      if (isCurrent()) setPending(null)
    }
  }, [reload, runtime, setError, setPending])
}

function useDetectAgents(state: AISettingsState, runtime: AISettingsRuntime, execute: (action: ExecuteAIAction) => Promise<void>) {
  const { setAgents } = state
  return useCallback(async () => {
    await execute({ name: 'agents', success: t('Agent 检测完成'), action: async () => {
      const lifecycleToken = runtime.lifecycle.current
      const request = ++runtime.agentRequest.current
      const nextAgents = await AIService.DetectAgentCLIs()
      if (runtime.lifecycle.current === lifecycleToken && runtime.agentRequest.current === request) setAgents(nextAgents)
    }, refresh: false })
  }, [execute, runtime, setAgents])
}

export function useAISettings(): AISettingsController {
  const state = useAISettingsState()
  const runtime = useAISettingsRuntime()
  const reload = useAIReload(state, runtime)
  const execute = useAIExecute(state, runtime, reload)
  const detectAgents = useDetectAgents(state, runtime, execute)
  useEffect(() => {
    void reload()
  }, [reload])
  return {
    dashboard: state.dashboard,
    agents: state.agents,
    loading: state.loading,
    pending: state.pending,
    error: state.error,
    reload,
    saveProvider: async (input) => {
      let saved: AIProviderProfile | null = null
      await execute({ name: 'provider-save', success: t('提供商配置已保存'), action: async () => {
        saved = await AIService.SaveProvider(input)
      } })
      emitAIConfigurationChanged()
      return saved
    },
    deleteProvider: async (id) => {
      await execute({ name: 'provider-delete', success: t('提供商配置已删除'), action: () => AIService.DeleteProvider(id) })
      emitAIConfigurationChanged()
    },
    testProvider: (id) => execute({ name: 'provider-test', success: t('提供商连接测试成功'), action: () => AIService.TestProvider(id), refresh: false }),
    saveSettings: async (input, options?: { quiet?: boolean }) => {
      await execute({ name: 'settings', success: t('AI 配置已保存'), action: async () => {
        await AIService.SaveSettings(input)
        writeStorageItem('mssh:tool-panel-width:ai', String(input.interaction.panel_width))
      }, quiet: options?.quiet === true })
      emitAIConfigurationChanged()
    },
    detectAgents,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
