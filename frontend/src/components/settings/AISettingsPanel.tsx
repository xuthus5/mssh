import { useCallback } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AIProviderPanel } from '@/components/settings/AIProviderPanel'
import { AIAgentPanel } from '@/components/settings/AIAgentPanel'
import { AutoSaveStatusIndicator } from '@/components/settings/AutoSaveStatus'
import { AIInteractionSettingsSection, AISearchSettingsSection, AISecuritySettingsSection } from '@/components/settings/AISettingsSections'
import { useAutoSave, type UseAutoSaveResult } from '@/hooks/useAutoSave'
import { useDraftSync } from '@/hooks/useDraftSync'
import { useSettingsWindowHide } from '@/hooks/useSettingsWindowHide'
import type { AISettingsController } from '@/hooks/useAISettings'
import { AISearchMode, AISearchProvider, type AISettingsDashboard, type AISettingsInput } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { t } from '@/i18n'


const emptyAISettingsInput: AISettingsInput = {
  default_provider_id: null,
  fallback_provider_id: null,
  interaction: {
    panel_width: 420,
    context_lines: 80,
    include_session_metadata: true,
    include_system_summary: true,
    stream_responses: true,
    auto_scroll: true,
    render_markdown: true,
    history_retention_days: 30,
    max_conversations: 100,
  },
  search: {
    enabled: false,
    mode: AISearchMode.AISearchAuto,
    provider: AISearchProvider.AISearchProviderBrave,
    timeout_seconds: 10,
    max_results: 5,
    require_citations: true,
    api_key: '',
  },
  security: {
    auto_execute_read_only: false,
    command_timeout_seconds: 60,
    max_output_bytes: 65536,
    max_plan_steps: 5,
    allow_patterns: [],
    deny_patterns: [],
    redaction_patterns: [],
  },
}

function settingsInput(dashboard: AISettingsDashboard): AISettingsInput {
  const { search, ...rest } = dashboard.settings
  return {
    ...rest,
    search: {
      enabled: search.enabled,
      mode: search.mode,
      provider: search.provider,
      timeout_seconds: search.timeout_seconds,
      max_results: search.max_results,
      require_citations: search.require_citations,
      api_key: '',
    },
  }
}

function createDraft(dashboard: AISettingsDashboard | null): AISettingsInput {
  return dashboard ? settingsInput(dashboard) : emptyAISettingsInput
}

export function AISettingsPanel({ controller }: { controller: AISettingsController }) {
  const state = useAISettingsPanelState(controller)
  if (controller.loading && !state.dashboard) return <AISettingsLoading />
  if (!state.dashboard) return <AISettingsFailure error={controller.error} />
  return <AISettingsTabs controller={controller} {...state} dashboard={state.dashboard} />
}

function useAISettingsPanelState(controller: AISettingsController) {
  const dashboard = controller.dashboard
  const { draft, setDraft, acknowledgeSaved, baselineRevision } = useDraftSync({ source: dashboard, createDraft })
  const persist = useCallback(
    async (next: AISettingsInput) => {
      await controller.saveSettings(next, { quiet: true })
      acknowledgeSaved(next, savedAISettingsDraft(next))
    },
    [acknowledgeSaved, controller],
  )
  const autoSave = useAutoSave({
    value: draft,
    onSave: async (next) => {
      await persist(next)
    },
    enabled: dashboard !== null && (controller.pending === null || controller.pending === 'settings'),
    isReady: dashboard !== null,
    delayMs: 450,
    baselineRevision,
  })
  useSettingsWindowHide(useCallback(() => {
    if (!draft.search.api_key) return
    const redacted = savedAISettingsDraft(draft)
    autoSave.redact(draft, redacted)
    setDraft(redacted)
  }, [autoSave.redact, draft, setDraft]))
  const update = useCallback((changes: Partial<AISettingsInput>) => {
    setDraft((current) => ({ ...current, ...changes }))
  }, [setDraft])
  const removeProvider = useCallback((providerID: number) => {
    setDraft((current) => ({
      ...current,
      default_provider_id: current.default_provider_id === providerID ? null : current.default_provider_id,
      fallback_provider_id: current.fallback_provider_id === providerID ? null : current.fallback_provider_id,
    }))
  }, [setDraft])
  return { dashboard, draft, autoSave, update, removeProvider }
}

function AISettingsLoading() {
  return <p className="p-8 text-center text-sm text-muted-foreground">{t('正在加载 AI 配置...')}</p>
}

function savedAISettingsDraft(input: AISettingsInput): AISettingsInput {
  return { ...input, search: { ...input.search, api_key: '' } }
}

function AISettingsFailure({ error }: { error: string | null }) {
  return <div className="space-y-2 p-8 text-center">
    <p className="text-sm text-destructive">{t('AI 配置加载失败')}</p>
    {error ? <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</div> : null}
  </div>
}

function AISettingsTabs({ controller, dashboard, draft, autoSave, update, removeProvider }: {
  controller: AISettingsController
  dashboard: AISettingsDashboard
  draft: AISettingsInput
  autoSave: UseAutoSaveResult<AISettingsInput>
  update: (changes: Partial<AISettingsInput>) => void
  removeProvider: (providerID: number) => void
}) {
  return <Tabs defaultValue="providers" className="min-h-0 flex flex-col gap-4" orientation="horizontal">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList className="mssh-tab-strip-scroll h-auto min-w-0 flex-1 flex-row flex-nowrap justify-start overflow-x-auto overflow-y-hidden">
          <TabsTrigger value="providers">{t('提供商')}</TabsTrigger>
          <TabsTrigger value="agents">Agent</TabsTrigger>
          <TabsTrigger value="interaction">{t('交互配置')}</TabsTrigger>
          <TabsTrigger value="search">{t('网络搜索')}</TabsTrigger>
          <TabsTrigger value="security">{t('安全配置')}</TabsTrigger>
        </TabsList>
        <AutoSaveStatusIndicator status={autoSave.status} error={autoSave.error} />
      </div>
      <TabsContent value="providers" className="min-h-0 overflow-y-auto">
        <AIProviderPanel controller={controller} priorities={draft} onPriorityChange={update} onProviderDeleted={removeProvider} />
      </TabsContent>
      <TabsContent value="agents" className="min-h-0 overflow-y-auto">
        <AIAgentPanel controller={controller} />
      </TabsContent>
      <TabsContent value="interaction" className="min-h-0 overflow-y-auto">
        <AIInteractionSettingsSection draft={draft} update={update} />
      </TabsContent>
      <TabsContent value="search" className="min-h-0 overflow-y-auto">
        <AISearchSettingsSection draft={draft} update={update} saved={dashboard.settings.search.credential_saved} />
      </TabsContent>
      <TabsContent value="security" className="min-h-0 overflow-y-auto">
        <AISecuritySettingsSection draft={draft} update={update} />
      </TabsContent>
    </Tabs>
}
