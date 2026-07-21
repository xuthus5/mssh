import { useEffect } from 'react'
import { CheckCircle2, RefreshCw, TerminalSquare, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { AISettingsController } from '@/hooks/useAISettings'
import { t } from '@/i18n'


export function AIAgentPanel({ controller }: { controller: AISettingsController }) {
  useEffect(() => { void controller.detectAgents() }, [controller.detectAgents])
  return <Card className="shadow-sm"><CardHeader className="flex-row items-center justify-between"><div><CardTitle className="text-sm">{t('本机 Agent CLI')}</CardTitle><p className="mt-1 text-xs text-muted-foreground">{t('只检测本机安装状态，不会向 SSH 服务器安装或执行 Agent。')}</p></div><Button size="sm" variant="outline" disabled={controller.pending === 'agents'} onClick={() => void controller.detectAgents()}><RefreshCw data-icon="inline-start" className={controller.pending === 'agents' ? 'animate-spin' : ''} />{t('重新检测')}</Button></CardHeader><CardContent className="grid gap-2 md:grid-cols-3">{controller.agents.map((agent) => <div key={agent.command} className="rounded-lg border border-border p-4"><div className="flex items-center gap-2 text-sm font-medium">{agent.installed ? <CheckCircle2 className="size-4 text-emerald-600" /> : <XCircle className="size-4 text-muted-foreground" />}<TerminalSquare className="size-4" />{agent.name}</div><dl className="mt-3 space-y-1 text-xs text-muted-foreground"><div className="flex justify-between gap-3"><dt>{t('命令')}</dt><dd className="font-mono text-foreground">{agent.command}</dd></div><div className="flex justify-between gap-3"><dt>{t('版本')}</dt><dd className="max-w-[12rem] truncate text-foreground" title={agent.version}>{agent.version || agent.error || t('未安装')}</dd></div>{agent.path && <div className="flex justify-between gap-3"><dt>{t('路径')}</dt><dd className="max-w-[12rem] truncate font-mono text-foreground" title={agent.path}>{agent.path}</dd></div>}</dl></div>)}</CardContent></Card>
}
