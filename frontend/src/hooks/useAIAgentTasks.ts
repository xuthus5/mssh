import { useCallback, useEffect, useRef, useState } from 'react'
import { Events } from '@wailsio/runtime'
import { AIService } from '@/lib/wails'
import type { AIAgentCLI, AIAgentEngine, AIAgentTask } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'

const TASK_EVENT = 'ai:agent-task-changed'
const STEP_EVENT = 'ai:agent-step-changed'
type RunAgentTaskInput = { sessionID: number; prompt: string; engine: AIAgentEngine | null; cli: AIAgentCLI | null }

export function useAIAgentTasks(sessionID = 0, enabled = true) {
  const [tasks, setTasks] = useState<AIAgentTask[]>([])
  const [selectedID, setSelectedID] = useState(0)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState('')
  const generation = useRef(0)

  const reload = useCallback(async () => {
	if (!enabled) return
    const request = ++generation.current
    try {
      const next = await AIService.ListAgentTasks(sessionID, 100)
      if (request !== generation.current) return
      setTasks(next ?? [])
      setSelectedID((current) => current && next?.some((task) => task.id === current) ? current : (next?.[0]?.id ?? 0))
      setError('')
    } catch (loadError) {
      if (request === generation.current) setError(errorMessage(loadError))
    } finally {
      if (request === generation.current) setLoading(false)
    }
  }, [enabled, sessionID])

  useEffect(() => { void reload() }, [reload])
  useEffect(() => enabled ? Events.On(TASK_EVENT, () => { void reload() }) : undefined, [enabled, reload])
  useEffect(() => enabled ? Events.On(STEP_EVENT, () => { void reload() }) : undefined, [enabled, reload])

  const actions = useAIAgentTaskActions({ reload, setSelectedID, setPending, setError })
  const selected = tasks.find((task) => task.id === selectedID) ?? null
  return { tasks, selected, selectedID, setSelectedID, loading, pending, error, reload, ...actions }
}

function useAIAgentTaskActions({ reload, setSelectedID, setPending, setError }: {
  reload: () => Promise<void>; setSelectedID: (id: number) => void
  setPending: (value: string | null) => void; setError: (value: string) => void
}) {
  const action = useCallback(async <T,>(name: string, operation: () => Promise<T>): Promise<T> => {
    setPending(name); setError('')
    try { const result = await operation(); await reload(); return result }
    catch (actionError) { setError(errorMessage(actionError)); throw actionError }
    finally { setPending(null) }
  }, [reload, setError, setPending])
  const run = useCallback(async (input: RunAgentTaskInput) => {
    const task = await action('start', () => AIService.StartAgentTask({ session_id: input.sessionID, prompt: input.prompt, engine: input.engine, cli: input.cli }))
    if (task) setSelectedID(task.id)
    return task
  }, [action, setSelectedID])
  return {
    run,
    approve: (taskID: number, stepID: number, approved: boolean) => action('approval', () => AIService.ApproveAgentStep(taskID, stepID, approved)),
    cancel: (taskID: number) => action('cancel', () => AIService.CancelAgentTask(taskID)),
    resume: (taskID: number) => action('resume', () => AIService.ResumeAgentTask(taskID)),
    remove: (taskID: number) => action('remove', () => AIService.DeleteAgentTask(taskID)),
  }
}

function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error) }
