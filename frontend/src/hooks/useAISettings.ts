import { useCallback, useEffect, useState } from 'react'
import { AIService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import type { AIAgentCLIStatus, AIProviderProfile, AIProviderProfileInput, AISettingsDashboard, AISettingsInput } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { t } from '@/i18n'


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

export function useAISettings(): AISettingsController {
  const [dashboard, setDashboard] = useState<AISettingsDashboard | null>(null)
  const [agents, setAgents] = useState<AIAgentCLIStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(async () => {
    try { setDashboard(await AIService.Dashboard()); setError(null) }
    catch (loadError) { setError(errorMessage(loadError)); logger.error('load AI settings failed', loadError) }
    finally { setLoading(false) }
  }, [])
  const execute = useCallback(async (name: string, success: string, action: () => Promise<unknown>, refresh = true, quiet = false) => {
    setPending(name); setError(null)
    try { await action(); if (refresh) await reload(); if (!quiet) toast(success, 'success') }
    catch (actionError) { const message = errorMessage(actionError); setError(message); if (!quiet) toast(t('${}失败: ${}', success, message), 'error'); throw actionError }
    finally { setPending(null) }
  }, [reload])
  const detectAgents = useCallback(async () => {
    await execute('agents', t('Agent 检测完成'), async () => { setAgents(await AIService.DetectAgentCLIs()) }, false)
  }, [execute])
  useEffect(() => { void reload() }, [reload])
  return {
    dashboard, agents, loading, pending, error, reload,
    saveProvider: async (input) => { let saved: AIProviderProfile | null = null; await execute('provider-save', t('提供商配置已保存'), async () => { saved = await AIService.SaveProvider(input) }); return saved },
    deleteProvider: (id) => execute('provider-delete', t('提供商配置已删除'), () => AIService.DeleteProvider(id)),
    testProvider: (id) => execute('provider-test', t('提供商连接测试成功'), () => AIService.TestProvider(id), false),
    saveSettings: (input, options?: { quiet?: boolean }) => execute('settings', t('AI 配置已保存'), async () => { await AIService.SaveSettings(input); localStorage.setItem('mssh:tool-panel-width:ai', String(input.interaction.panel_width)) }, true, options?.quiet === true),
    detectAgents,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
