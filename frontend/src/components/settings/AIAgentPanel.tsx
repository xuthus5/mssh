import { useEffect, useRef } from 'react'
import { Bot, CheckCircle2, RefreshCw, ShieldAlert, TerminalSquare, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { Switch } from '@/components/ui/switch'
import type { AISettingsController } from '@/hooks/useAISettings'
import { isOperationBusyError } from '@/lib/operationBusyError'
import { t } from '@/i18n'
import { AIAgentCLI, AIAgentEngine, type AIAgentCLIStatus, type AISettingsInput } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

const fallbackInteraction = {
  panel_width: 420,
  context_lines: 80,
  include_session_metadata: true,
  include_system_summary: true,
  stream_responses: true,
  auto_scroll: true,
  render_markdown: true,
  history_retention_days: 30,
  max_conversations: 100,
  agent: { default_engine: AIAgentEngine.AIAgentEngineNative, default_cli: AIAgentCLI.AIAgentCLICodex, allow_codex: false },
}

export function AIAgentPanel({ controller, draft, update = () => undefined }: { controller: AISettingsController; draft?: AISettingsInput; update?: (changes: Partial<AISettingsInput>) => void }) {
  const autoRequested = useRef(false)
  useEffect(() => {
    if (controller.pending !== null || autoRequested.current) return
    autoRequested.current = true
    void controller.detectAgents().catch((error: unknown) => {
      if (isOperationBusyError(error)) autoRequested.current = false
    })
  }, [controller.detectAgents, controller.pending])
  const interaction = draft?.interaction ?? fallbackInteraction
  const agent = interaction.agent
  const setAgent = (changes: Partial<typeof agent>) => update({ interaction: { ...interaction, agent: { ...agent, ...changes } } })
  return (
    <div className="grid gap-4">
      <DefaultEngineCard agent={agent} setAgent={setAgent} agents={controller.agents} />
      <AgentCLIStatusCard controller={controller} detecting={controller.pending === 'agents'} />
    </div>
  )
}

function DefaultEngineCard({ agent, setAgent, agents }: {
  agent: AISettingsInput['interaction']['agent']
  setAgent: (changes: Partial<AISettingsInput['interaction']['agent']>) => void
  agents: AIAgentCLIStatus[]
}) {
  const selectedStatus = agents.find((item) => item.command === agent.default_cli)
  const codexSelected = agent.default_engine === AIAgentEngine.AIAgentEngineLocalCLI && agent.default_cli === AIAgentCLI.AIAgentCLICodex
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Bot className="size-4" />
          {t('默认 Agent 引擎')}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid grid-cols-2 rounded-lg border border-border p-1">
          <Button type="button" variant={agent.default_engine === AIAgentEngine.AIAgentEngineNative ? 'secondary' : 'ghost'} onClick={() => setAgent({ default_engine: AIAgentEngine.AIAgentEngineNative })}>{t('原生 Agent')}</Button>
          <Button type="button" variant={agent.default_engine === AIAgentEngine.AIAgentEngineLocalCLI ? 'secondary' : 'ghost'} onClick={() => setAgent({ default_engine: AIAgentEngine.AIAgentEngineLocalCLI })}>{t('本机 CLI')}</Button>
        </div>
        {agent.default_engine === AIAgentEngine.AIAgentEngineLocalCLI ? (
          <div className="grid gap-1.5">
            <span className="text-xs text-muted-foreground">{t('默认 CLI')}</span>
            <LabeledSelect value={agent.default_cli} onValueChange={(value) => setAgent({ default_cli: value as AIAgentCLI })} ariaLabel={t('默认 Agent CLI')} options={agents.map((item) => ({ value: item.command, label: item.name + (item.version ? ` · ${item.version}` : ''), disabled: !item.installed || Boolean(item.error) }))} />
            {selectedStatus?.error ? <p className="text-xs text-destructive">{selectedStatus.error}</p> : null}
            {codexSelected ? <CodexWeakIsolationOption allowCodex={agent.allow_codex} onChange={(value) => setAgent({ allow_codex: value })} /> : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function CodexWeakIsolationOption({ allowCodex, onChange }: { allowCodex: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-amber-500" />
          {t('允许 Codex 弱隔离运行')}
        </span>
        <Switch checked={allowCodex} onCheckedChange={onChange} />
      </label>
      <p className="mt-2 text-xs text-muted-foreground">{t('Codex 无官方 MCP-only 模式，无法证明本地 Shell 隔离；开启后任务仅靠工具白名单与事件校验兜底，存在安全风险。')}</p>
    </div>
  )
}

function AgentCLIStatusCard({ controller, detecting }: { controller: AISettingsController; detecting: boolean }) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="text-sm">{t('本机 Agent CLI')}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{t('仅允许通过任务绑定的 MSSH MCP 工具操作远程主机。')}</p>
        </div>
        <Button size="sm" variant="outline" disabled={controller.pending !== null} onClick={() => { void controller.detectAgents().catch(() => undefined) }}>
          <RefreshCw data-icon="inline-start" className={detecting ? 'animate-spin' : ''} />
          {t('重新检测')}
        </Button>
      </CardHeader>
      <CardContent className="grid gap-2 md:grid-cols-3">
        {controller.agents.map((item) => <AgentCLIStatusCardItem key={item.command} item={item} />)}
      </CardContent>
    </Card>
  )
}

function AgentCLIStatusCardItem({ item }: { item: AIAgentCLIStatus }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        {item.installed ? <CheckCircle2 className="size-4 text-emerald-600" /> : <XCircle className="size-4 text-muted-foreground" />}
        <TerminalSquare className="size-4" />
        {item.name}
      </div>
      <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
        <div className="flex justify-between gap-3">
          <dt>{t('命令')}</dt>
          <dd className="font-mono text-foreground">{item.command}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>{t('版本')}</dt>
          <dd className="max-w-[12rem] truncate text-foreground" title={item.version}>{item.version || item.error || t('未安装')}</dd>
        </div>
        {item.path ? (
          <div className="flex justify-between gap-3">
            <dt>{t('路径')}</dt>
            <dd className="max-w-[12rem] truncate font-mono text-foreground" title={item.path}>{item.path}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  )
}
