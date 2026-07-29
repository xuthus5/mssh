import { useMemo, useState } from 'react'
import { AlertTriangle, Check, CircleStop, Clock3, Play, RotateCcw, ShieldAlert, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'
import { useAIAgentTasks } from '@/hooks/useAIAgentTasks'
import { AIAgentCLI, AIAgentEngine, AIAgentTaskStatus, type AIAgentTask } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

export function AIAgentSessionPanel({ sessionID, sessionName, compact = false }: { sessionID: number; sessionName: string; compact?: boolean }) {
  const controller = useAIAgentTasks(sessionID)
  const [prompt, setPrompt] = useState('')
  const [engine, setEngine] = useState('default')
  const [cli, setCLI] = useState('default')
  const canRun = prompt.trim() && controller.pending === null
  const submit = async () => {
    if (!canRun) return
    await controller.run({ sessionID, prompt: prompt.trim(), engine: engine === 'default' ? null : engine as AIAgentEngine, cli: cli === 'default' ? null : cli as AIAgentCLI })
    setPrompt('')
  }
  return <div className={cn('flex min-h-0 flex-1 flex-col', compact ? 'gap-0' : 'gap-4')}>
    <div className="grid gap-2 border-b border-border p-3">
      <div className="flex gap-2">
        <LabeledSelect value={engine} onValueChange={setEngine} ariaLabel={t('任务引擎')} className="flex-1" options={[{ value: 'default', label: t('继承默认引擎') }, { value: AIAgentEngine.AIAgentEngineNative, label: t('原生 Agent') }, { value: AIAgentEngine.AIAgentEngineLocalCLI, label: t('本机 CLI') }]} />
        {(engine === AIAgentEngine.AIAgentEngineLocalCLI) && <LabeledSelect value={cli} onValueChange={setCLI} ariaLabel={t('Agent CLI')} className="flex-1" options={[{ value: 'default', label: t('继承默认 CLI') }, { value: AIAgentCLI.AIAgentCLICodex, label: 'Codex' }, { value: AIAgentCLI.AIAgentCLIClaude, label: 'Claude Code' }, { value: AIAgentCLI.AIAgentCLIOpenCode, label: 'OpenCode' }]} />}
      </div>
      <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={t('描述要在 ${} 上完成的任务', sessionName)} rows={compact ? 3 : 4} />
      <Button disabled={!canRun} onClick={() => { void submit() }}><Play data-icon="inline-start" />{controller.pending === 'start' ? t('正在启动…') : t('运行 Agent')}</Button>
      {controller.error ? <p role="alert" className="text-xs text-destructive">{controller.error}</p> : null}
    </div>
    <AIAgentTaskWorkspace controller={controller} />
  </div>
}

export function AIAgentTaskWorkspace({ controller }: { controller: ReturnType<typeof useAIAgentTasks> }) {
  if (controller.loading && controller.tasks.length === 0) return <p className="p-4 text-xs text-muted-foreground">{t('正在加载 Agent 任务…')}</p>
  if (controller.tasks.length === 0) return <p className="p-4 text-xs text-muted-foreground">{t('暂无 Agent 任务')}</p>
  return <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(180px,0.36fr)_minmax(0,1fr)]">
    <div className="min-h-0 overflow-y-auto border-r border-border p-2">{controller.tasks.map((task) => <TaskListItem key={task.id} task={task} selected={task.id === controller.selectedID} onClick={() => controller.setSelectedID(task.id)} />)}</div>
    <div className="min-h-0 overflow-y-auto"><TaskDetail task={controller.selected} pending={controller.pending} approve={controller.approve} cancel={controller.cancel} resume={controller.resume} /></div>
  </div>
}

function TaskListItem({ task, selected, onClick }: { task: AIAgentTask; selected: boolean; onClick: () => void }) {
  return <button type="button" className={cn('mb-1 w-full rounded-lg border px-2.5 py-2 text-left transition-colors', selected ? 'border-primary/50 bg-primary/5' : 'border-transparent hover:bg-muted')} onClick={onClick}>
    <div className="flex items-center justify-between gap-2"><span className="truncate text-xs font-medium">{task.session_name}</span><TaskStatusBadge status={task.status} /></div>
    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{task.prompt}</p>
  </button>
}

function TaskDetail({ task, pending, approve, cancel, resume }: { task: AIAgentTask | null; pending: string | null; approve: ReturnType<typeof useAIAgentTasks>['approve']; cancel: ReturnType<typeof useAIAgentTasks>['cancel']; resume: ReturnType<typeof useAIAgentTasks>['resume'] }) {
  if (!task) return null
  const active = [AIAgentTaskStatus.AIAgentTaskPending, AIAgentTaskStatus.AIAgentTaskRunning, AIAgentTaskStatus.AIAgentTaskWaitingApproval].includes(task.status)
  return <div className="p-4">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3"><div><div className="flex items-center gap-2"><h3 className="text-sm font-semibold">{task.session_name}</h3><TaskStatusBadge status={task.status} /></div><p className="mt-1 text-xs text-muted-foreground">{task.engine === AIAgentEngine.AIAgentEngineNative ? t('原生 Agent') : task.cli}</p></div><div className="flex gap-2">{active ? <Button size="sm" variant="outline" disabled={pending !== null} onClick={() => { void cancel(task.id) }}><CircleStop data-icon="inline-start" />{t('取消')}</Button> : null}{task.status === AIAgentTaskStatus.AIAgentTaskInterrupted ? <Button size="sm" disabled={pending !== null} onClick={() => { void resume(task.id) }}><RotateCcw data-icon="inline-start" />{t('恢复')}</Button> : null}</div></div>
    <p className="border-b border-border py-3 text-sm">{task.prompt}</p>
    <div className="relative mt-4 space-y-4 before:absolute before:bottom-3 before:left-[7px] before:top-3 before:w-px before:bg-border">{task.steps.map((step) => <div key={step.id} className="relative pl-6"><span className={cn('absolute left-0 top-1.5 size-3.5 rounded-full border-2 border-background', step.approval_status === 'pending' ? 'bg-amber-500' : step.error ? 'bg-destructive' : 'bg-primary')} /><div className="rounded-lg border border-border p-3 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-2"><code className="text-xs font-semibold">{step.tool_name}</code><Badge variant="outline">{step.risk}</Badge></div>{step.model_output ? <p className="mt-2 text-xs text-muted-foreground">{step.model_output}</p> : null}<CodeBlock value={step.tool_input} />{step.tool_output ? <CodeBlock value={step.tool_output} muted /> : null}{step.error ? <p className="mt-2 text-xs text-destructive">{step.error}</p> : null}{step.approval_status === 'pending' ? <div className="mt-3 flex gap-2 border-t border-border pt-3"><Button size="sm" disabled={pending !== null} onClick={() => { void approve(task.id, step.id, true) }}><Check data-icon="inline-start" />{t('批准')}</Button><Button size="sm" variant="outline" disabled={pending !== null} onClick={() => { void approve(task.id, step.id, false) }}><X data-icon="inline-start" />{t('拒绝')}</Button></div> : null}</div></div>)}</div>
    {task.result ? <div className="mt-4 border-t border-border pt-4"><p className="text-xs font-medium">{t('任务结果')}</p><p className="mt-2 whitespace-pre-wrap text-sm">{task.result}</p></div> : null}
    {task.error ? <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">{task.error}</p> : null}
  </div>
}

function CodeBlock({ value, muted = false }: { value: string; muted?: boolean }) { return <pre className={cn('mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border p-2 text-[11px]', muted ? 'bg-muted/40 text-muted-foreground' : 'bg-background text-foreground')}>{prettyJSON(value)}</pre> }
function prettyJSON(value: string) { try { return JSON.stringify(JSON.parse(value), null, 2) } catch { return value } }

function TaskStatusBadge({ status }: { status: AIAgentTask['status'] }) {
	const meta = useMemo<{ icon: typeof Clock3; label: string }>(() => {
		switch (status) {
			case 'running': return { icon: Play, label: t('运行中') }
			case 'waiting_approval': return { icon: ShieldAlert, label: t('待审批') }
			case 'completed': return { icon: Check, label: t('完成') }
			case 'failed': return { icon: AlertTriangle, label: t('失败') }
			case 'cancelled': return { icon: CircleStop, label: t('已取消') }
			case 'interrupted': return { icon: RotateCcw, label: t('已中断') }
			default: return { icon: Clock3, label: t('等待') }
		}
	}, [status])
	const Icon = meta.icon
	return <Badge variant={status === 'waiting_approval' || status === 'failed' ? 'destructive' : 'secondary'} className="gap-1"><Icon className="size-3" />{meta.label}</Badge>
}
