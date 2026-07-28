import { useEffect, useRef, useState } from 'react'
import { Workflow } from 'lucide-react'
import QuickCommands from '@/components/session/QuickCommands'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { executeMacroOnActiveTerminal } from '@/lib/executeMacro'
import { logger } from '@/lib/logger'
import { MacroService } from '@/lib/wails'
import { useAppStore } from '@/store/appStore'
import { t } from '@/i18n'
import { emitMacroCatalogChanged, isMacroMutationActive, onMacroCatalogChanged, runMacroMutation, useMacroMutationState } from '@/lib/macroMutationCoordinator'

type MacroItem = { id: string; name: string; shortcut: string; command: string }

function useMacroRuntime() {
  const lifecycle = useRef(0)
  const loadRequest = useRef(0)
  const loadTask = useRef<Promise<void> | null>(null)
  const actionRequest = useRef(0)
  const actionActive = useRef(false)
  const source = useRef(Symbol('workspace-macros'))
  useEffect(() => {
    const token = ++lifecycle.current
    return () => {
      if (lifecycle.current !== token) return
      lifecycle.current++
      loadRequest.current++
      loadTask.current = null
      actionRequest.current++
      actionActive.current = false
    }
  }, [])
  return { lifecycle, loadRequest, loadTask, actionRequest, actionActive, source }
}

type MacroRuntime = ReturnType<typeof useMacroRuntime>

function useMacroLoader(runtime: MacroRuntime) {
  const [macros, setMacros] = useState<MacroItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const reload = (options?: { allowDuringAction?: boolean; allowDuringMutation?: boolean }) => {
    if (!options?.allowDuringAction && runtime.actionActive.current) return Promise.resolve()
    if (!options?.allowDuringMutation && isMacroMutationActive()) return Promise.resolve()
    if (runtime.loadTask.current) return runtime.loadTask.current
    const task = loadMacros(runtime, { setMacros, setLoading, setError, setActionError })
    runtime.loadTask.current = task
    void task.finally(() => {
      if (runtime.loadTask.current === task) runtime.loadTask.current = null
    })
    return task
  }
  useEffect(() => { void reload() }, [])
  const reloadRef = useRef(reload)
  reloadRef.current = reload
  useEffect(() => onMacroCatalogChanged(runtime.source.current, () => {
    void reloadRef.current({ allowDuringAction: true, allowDuringMutation: true })
  }), [runtime.source])
  return { macros, loading, error, actionError, setActionError, reload }
}

async function loadMacros(runtime: MacroRuntime, state: {
  setMacros: (items: MacroItem[]) => void
  setLoading: (loading: boolean) => void
  setError: (error: string) => void
  setActionError: (error: string) => void
}) {
  const lifecycleToken = runtime.lifecycle.current
  const request = ++runtime.loadRequest.current
  const isCurrent = () => runtime.lifecycle.current === lifecycleToken && runtime.loadRequest.current === request
  state.setLoading(true)
  state.setError('')
  state.setActionError('')
  try {
    const items = await MacroService.List()
    if (isCurrent()) state.setMacros((items ?? []).map((item) => ({
      id: String(item.id), name: item.name, shortcut: item.shortcut ?? '', command: item.command,
    })))
  } catch (loadError: unknown) {
    const message = loadError instanceof Error ? loadError.message : String(loadError)
    if (isCurrent()) { state.setError(message); logger.error('macros workspace load failed', loadError) }
  } finally {
    if (isCurrent()) state.setLoading(false)
  }
}

type MacroLoader = ReturnType<typeof useMacroLoader>

function useMacroActions(runtime: MacroRuntime, loader: MacroLoader) {
  const [pending, setPending] = useState(false)
  const execute = (command: string) => {
    const lifecycleToken = runtime.lifecycle.current
    void executeMacroOnActiveTerminal(command).catch((error: unknown) => {
      if (runtime.lifecycle.current !== lifecycleToken) return
      const message = error instanceof Error ? error.message : String(error)
      loader.setActionError(t('执行宏失败: ${}', message))
      logger.error('execute macro failed', error)
    })
  }
  const remove = async (id: string) => {
    const lifecycleToken = runtime.lifecycle.current
    if (runtime.actionActive.current) return
    runtime.actionActive.current = true
    setPending(true)
    const request = ++runtime.actionRequest.current
    const isCurrent = () => runtime.lifecycle.current === lifecycleToken && runtime.actionRequest.current === request
    try {
      loader.setActionError('')
      await runMacroMutation(async () => {
        const activeLoad = runtime.loadTask.current
        if (activeLoad) await activeLoad
        if (!isCurrent()) return
        await MacroService.Delete(Number(id))
        if (!isCurrent()) return
        await loader.reload({ allowDuringAction: true, allowDuringMutation: true })
        emitMacroCatalogChanged(runtime.source.current)
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      if (isCurrent()) { loader.setActionError(t('删除宏失败: ${}', message)); logger.error('delete macro failed', error) }
      throw error instanceof Error ? error : new Error(message)
    } finally {
      if (isCurrent()) {
        runtime.actionActive.current = false
        setPending(false)
      }
    }
  }
  return { execute, pending, remove }
}

export function MacrosWorkspace() {
  const runtime = useMacroRuntime()
  const loader = useMacroLoader(runtime)
  const actions = useMacroActions(runtime, loader)
  const mutationBusy = useMacroMutationState((state) => state.busy)
  if (loader.loading && loader.macros.length === 0) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{t('加载宏...')}</div>
  if (loader.error) return <MacroLoadError error={loader.error} reload={loader.reload} />
  if (loader.macros.length === 0) return <MacroEmpty />
  return <MacroList loader={loader} actions={actions} mutationBusy={mutationBusy} />
}

function MacroLoadError({ error, reload }: { error: string; reload: () => Promise<void> }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
    <Empty><EmptyHeader><EmptyMedia variant="icon"><Workflow /></EmptyMedia><EmptyTitle>{t('宏加载失败')}</EmptyTitle><EmptyDescription>{error}</EmptyDescription></EmptyHeader></Empty>
    <Button onClick={() => { void reload() }}>{t('重试')}</Button>
  </div>
}

function MacroEmpty() {
  return <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6" aria-label={t('宏工作区')}>
    <Empty><EmptyHeader><EmptyMedia variant="icon"><Workflow /></EmptyMedia><EmptyTitle>{t('还没有宏')}</EmptyTitle><EmptyDescription>{t('在侧边栏「宏」中新增命令，或在此管理快捷命令模板。')}</EmptyDescription></EmptyHeader></Empty>
    <Button variant="outline" onClick={() => useAppStore.getState().activateWorkspace('macros')}>{t('打开侧边栏宏面板')}</Button>
  </div>
}

function MacroList({ loader, actions, mutationBusy }: { loader: MacroLoader; actions: ReturnType<typeof useMacroActions>; mutationBusy: boolean }) {
  return <div className="flex min-h-0 flex-1 flex-col bg-background p-4" aria-label={t('宏工作区')}>
    <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-medium">{t('宏工作区')}</h2><Button size="sm" variant="outline" disabled={mutationBusy || loader.loading || actions.pending} onClick={() => { void loader.reload() }}>{t('刷新')}</Button></div>
    {loader.actionError ? <div className="mb-3 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{loader.actionError}</div> : null}
    <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border">
      <QuickCommands commands={loader.macros} showAddForm={false} mutationDisabled={mutationBusy} onExecute={actions.execute} onAdd={() => {}} onDelete={actions.remove} />
    </div>
  </div>
}
