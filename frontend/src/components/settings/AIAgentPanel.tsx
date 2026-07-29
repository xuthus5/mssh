import { useEffect, useRef } from 'react'
import { Bot, CheckCircle2, RefreshCw, TerminalSquare, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LabeledSelect } from '@/components/ui/labeled-select'
import type { AISettingsController } from '@/hooks/useAISettings'
import { isOperationBusyError } from '@/lib/operationBusyError'
import { t } from '@/i18n'
import { AIAgentCLI, AIAgentEngine, type AISettingsInput } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'


export function AIAgentPanel({ controller, draft, update = () => undefined }: { controller: AISettingsController; draft?: AISettingsInput; update?: (changes: Partial<AISettingsInput>) => void }) {
  const autoRequested = useRef(false)
  useEffect(() => {
    if (controller.pending !== null || autoRequested.current) return
    autoRequested.current = true
    void controller.detectAgents().catch((error: unknown) => {
      if (isOperationBusyError(error)) autoRequested.current = false
    })
  }, [controller.detectAgents, controller.pending])
  const detecting = controller.pending === 'agents'
  const interaction = draft?.interaction ?? { panel_width: 420, context_lines: 80, include_session_metadata: true, include_system_summary: true, stream_responses: true, auto_scroll: true, render_markdown: true, history_retention_days: 30, max_conversations: 100, agent: { default_engine: AIAgentEngine.AIAgentEngineNative, default_cli: AIAgentCLI.AIAgentCLICodex } }
  const agent = interaction.agent
  const setAgent = (changes: Partial<typeof agent>) => update({ interaction: { ...interaction, agent: { ...agent, ...changes } } })
  const selectedStatus = controller.agents.find((item) => item.command === agent.default_cli)
  return <div className="grid gap-4"><Card className="shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Bot className="size-4" />{t('默认 Agent 引擎')}</CardTitle></CardHeader><CardContent className="grid gap-4"><div className="grid grid-cols-2 rounded-lg border border-border p-1"><Button type="button" variant={agent.default_engine === AIAgentEngine.AIAgentEngineNative ? 'secondary' : 'ghost'} onClick={() => setAgent({ default_engine: AIAgentEngine.AIAgentEngineNative })}>{t('原生 Agent')}</Button><Button type="button" variant={agent.default_engine === AIAgentEngine.AIAgentEngineLocalCLI ? 'secondary' : 'ghost'} onClick={() => setAgent({ default_engine: AIAgentEngine.AIAgentEngineLocalCLI })}>{t('本机 CLI')}</Button></div>{agent.default_engine === AIAgentEngine.AIAgentEngineLocalCLI ? <div className="grid gap-1.5"><span className="text-xs text-muted-foreground">{t('默认 CLI')}</span><LabeledSelect value={agent.default_cli} onValueChange={(value) => setAgent({ default_cli: value as AIAgentCLI })} ariaLabel={t('默认 Agent CLI')} options={controller.agents.map((item) => ({ value: item.command, label: item.name + (item.version ? ` · ${item.version}` : ''), disabled: !item.installed || Boolean(item.error) }))} />{selectedStatus?.error ? <p className="text-xs text-destructive">{selectedStatus.error}</p> : null}</div> : null}</CardContent></Card>
  <Card className="shadow-sm"><CardHeader className="flex-row items-center justify-between"><div><CardTitle className="text-sm">{t('本机 Agent CLI')}</CardTitle><p className="mt-1 text-xs text-muted-foreground">{t('仅允许通过任务绑定的 MSSH MCP 工具操作远程主机。')}</p></div><Button size="sm" variant="outline" disabled={controller.pending !== null} onClick={() => { void controller.detectAgents().catch(() => undefined) }}><RefreshCw data-icon="inline-start" className={detecting ? 'animate-spin' : ''} />{t('重新检测')}</Button></CardHeader><CardContent className="grid gap-2 md:grid-cols-3">{controller.agents.map((item) => <div key={item.command} className="rounded-lg border border-border p-4"><div className="flex items-center gap-2 text-sm font-medium">{item.installed ? <CheckCircle2 className="size-4 text-emerald-600" /> : <XCircle className="size-4 text-muted-foreground" />}<TerminalSquare className="size-4" />{item.name}</div><dl className="mt-3 space-y-1 text-xs text-muted-foreground"><div className="flex justify-between gap-3"><dt>{t('命令')}</dt><dd className="font-mono text-foreground">{item.command}</dd></div><div className="flex justify-between gap-3"><dt>{t('版本')}</dt><dd className="max-w-[12rem] truncate text-foreground" title={item.version}>{item.version || item.error || t('未安装')}</dd></div>{item.path && <div className="flex justify-between gap-3"><dt>{t('路径')}</dt><dd className="max-w-[12rem] truncate font-mono text-foreground" title={item.path}>{item.path}</dd></div>}</dl></div>)}</CardContent></Card></div>
}
