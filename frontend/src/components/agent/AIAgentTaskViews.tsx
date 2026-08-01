import { useMemo, useState } from 'react'
import { AlertTriangle, Check, CheckCircle2, CircleStop, Clock3, FileText, Play, RotateCcw, ShieldAlert, Trash2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { Textarea } from '@/components/ui/textarea'
import { requestConfirm } from '@/lib/confirmDialog'
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
    <div className="min-h-0 overflow-y-auto"><TaskDetail task={controller.selected} pending={controller.pending} approve={controller.approve} cancel={controller.cancel} resume={controller.resume} retry={controller.retry} remove={controller.remove} /></div>
  </div>
}

function TaskListItem({ task, selected, onClick }: { task: AIAgentTask; selected: boolean; onClick: () => void }) {
  return <button type="button" className={cn('mb-1 w-full rounded-lg border px-2.5 py-2 text-left transition-colors', selected ? 'border-primary/50 bg-primary/5' : 'border-transparent hover:bg-muted')} onClick={onClick}>
    <div className="flex items-center justify-between gap-2"><span className="truncate text-xs font-medium">{task.session_name}</span><TaskStatusBadge status={task.status} /></div>
    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{task.prompt}</p>
  </button>
}

function TaskDetail({ task, pending, approve, cancel, resume, retry, remove }: { task: AIAgentTask | null; pending: string | null; approve: ReturnType<typeof useAIAgentTasks>['approve']; cancel: ReturnType<typeof useAIAgentTasks>['cancel']; resume: ReturnType<typeof useAIAgentTasks>['resume']; retry: ReturnType<typeof useAIAgentTasks>['retry']; remove: ReturnType<typeof useAIAgentTasks>['remove'] }) {
  if (!task) return null
  const active = [AIAgentTaskStatus.AIAgentTaskPending, AIAgentTaskStatus.AIAgentTaskRunning, AIAgentTaskStatus.AIAgentTaskWaitingApproval].includes(task.status)
  const pendingStep = task.steps.find((step) => step.approval_status === 'pending')
  const waitingApproval = task.status === AIAgentTaskStatus.AIAgentTaskWaitingApproval && pendingStep !== undefined
  const removeTask = async () => {
    const confirmed = await requestConfirm({ title: t('删除任务？'), description: t('删除后任务记录与执行步骤将不可恢复。'), confirmLabel: t('删除'), destructive: true })
    if (!confirmed) return
    await remove(task.id)
  }
  return <div className="p-4">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3"><div><div className="flex items-center gap-2"><h3 className="text-sm font-semibold">{task.session_name}</h3><TaskStatusBadge status={task.status} /></div><p className="mt-1 text-xs text-muted-foreground">{task.engine === AIAgentEngine.AIAgentEngineNative ? t('原生 Agent') : task.cli}</p></div><div className="flex gap-2">{active ? <Button size="sm" variant="outline" disabled={pending !== null} onClick={() => { void cancel(task.id) }}><CircleStop data-icon="inline-start" />{t('取消')}</Button> : null}{task.status === AIAgentTaskStatus.AIAgentTaskInterrupted ? <Button size="sm" disabled={pending !== null} onClick={() => { void resume(task.id) }}><RotateCcw data-icon="inline-start" />{t('恢复')}</Button> : null}{task.status === AIAgentTaskStatus.AIAgentTaskFailed ? <Button size="sm" disabled={pending !== null} onClick={() => { void retry(task.id) }}><RotateCcw data-icon="inline-start" />{t('重试')}</Button> : null}<Button size="sm" variant="ghost" aria-label={t('删除任务')} disabled={pending !== null} onClick={() => { void removeTask() }}><Trash2 data-icon="inline-start" className="text-destructive" /></Button></div></div>
    <p className="border-b border-border py-3 text-sm">{task.prompt}</p>
    {waitingApproval && pendingStep ? <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/60 bg-amber-500/10 p-3"><div className="flex min-w-0 items-center gap-2 text-xs font-medium text-foreground"><ShieldAlert className="size-4 shrink-0 text-amber-500" /><span className="truncate">{t('等待审批：${}', pendingStep.tool_name)}</span></div><div className="flex gap-2"><Button size="sm" aria-label={t('批准任务')} disabled={pending !== null} onClick={() => { void approve(task.id, pendingStep.id, true) }}><Check data-icon="inline-start" />{t('批准')}</Button><Button size="sm" variant="destructive" aria-label={t('拒绝任务')} disabled={pending !== null} onClick={() => { void approve(task.id, pendingStep.id, false) }}><X data-icon="inline-start" />{t('拒绝')}</Button></div></div> : null}
    <div className="relative mt-4 space-y-4 before:absolute before:bottom-3 before:left-[7px] before:top-3 before:w-px before:bg-border">{task.steps.map((step) => <div key={step.id} className="relative pl-6"><span className={cn('absolute left-0 top-1.5 size-3.5 rounded-full border-2 border-background', step.approval_status === 'pending' ? 'bg-amber-500' : step.error ? 'bg-destructive' : 'bg-primary')} /><div className="rounded-lg border border-border p-3 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-2"><code className="text-xs font-semibold">{step.tool_name}</code><Badge variant="outline">{step.risk}</Badge></div>{step.model_output ? <p className="mt-2 text-xs text-muted-foreground">{step.model_output}</p> : null}<CodeBlock value={step.tool_input} />{step.tool_output ? <CodeBlock value={step.tool_output} muted /> : null}{step.error ? <p className="mt-2 text-xs text-destructive">{step.error}</p> : null}{step.approval_status === 'pending' ? <div className="mt-3 flex gap-2 border-t border-border pt-3"><Button size="sm" disabled={pending !== null} onClick={() => { void approve(task.id, step.id, true) }}><Check data-icon="inline-start" />{t('批准')}</Button><Button size="sm" variant="outline" disabled={pending !== null} onClick={() => { void approve(task.id, step.id, false) }}><X data-icon="inline-start" />{t('拒绝')}</Button></div> : null}</div></div>)}</div>
    {task.result ? <div className="mt-4 overflow-hidden rounded-xl border border-border bg-muted/40 shadow-sm"><div className="flex items-center justify-between gap-2 border-b border-border bg-background px-3 py-2"><div className="flex items-center gap-2 text-xs font-medium text-foreground">{task.status === AIAgentTaskStatus.AIAgentTaskCompleted ? <CheckCircle2 className="size-4 text-emerald-600" /> : <FileText className="size-4 text-muted-foreground" />}{t('任务结果')}</div>{task.started_at && task.finished_at ? <span className="text-xs text-muted-foreground">{t('耗时 ${}', formatAgentTaskDuration(task.started_at, task.finished_at))}</span> : null}</div><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-xs leading-relaxed text-foreground">{task.result}</pre></div> : null}
    {task.error ? <div className="mt-4 flex gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><pre className="whitespace-pre-wrap break-words font-mono leading-relaxed">{task.error}</pre></div> : null}
  </div>
}

function formatAgentTaskDuration(start: string | null, end: string | null): string {
  if (!start || !end) return ''
  const from = new Date(start).getTime()
  const to = new Date(end).getTime()
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return ''
  const seconds = Math.max(1, Math.round((to - from) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`
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
