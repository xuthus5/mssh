import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CommandItem } from '@/components/session/QuickCommands'
import type { Folder, Session } from '@/hooks/useSession'
import { MacroService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { executeMacroOnActiveTerminal } from '@/lib/executeMacro'
import { t } from '@/i18n'
import type { Macro, MacroInput } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { sessionAssetSearchText } from '@/lib/sessionAssetSearch'
import { emitMacroCatalogChanged, isMacroMutationActive, onMacroCatalogChanged, runMacroMutation, useMacroMutationState } from '@/lib/macroMutationCoordinator'

export { useSidebarDialogs } from '@/hooks/useSidebarDialogs'

export function useSidebarFilter(folders: Folder[], sessions: Session[]) {
  const [searchQuery, setSearchQuery] = useState('')
  const filteredSessions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const folderNames = new Map(folders.map((folder) => [folder.id, folder.name]))
    return query ? sessions.filter((session) => sessionAssetSearchText(session, folderNames.get(session.folderId ?? '') ?? '').includes(query)) : sessions
  }, [folders, sessions, searchQuery])
  const filteredFolders = useMemo(() => {
    if (!searchQuery.trim()) return folders
    const included = new Set<string>()
    for (const session of filteredSessions) {
      let parentID = session.folderId
      while (parentID) {
        if (included.has(parentID)) break
        included.add(parentID)
        parentID = folders.find((folder) => folder.id === parentID)?.parentId ?? null
      }
    }
    const query = searchQuery.toLowerCase()
    for (const folder of folders) if (folder.name.toLowerCase().includes(query)) included.add(folder.id)
    return folders.filter((folder) => included.has(folder.id))
  }, [folders, filteredSessions, searchQuery])
  return { searchQuery, setSearchQuery, filteredSessions, filteredFolders }
}

function macroItem(macro: Macro): CommandItem {
  return { id: String(macro.id), name: macro.name, shortcut: macro.shortcut, command: macro.command }
}

function macroErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type MacroFailure = {
  message: string
  kind: 'load' | 'action'
}

type SetMacroFailure = (failure: MacroFailure | null) => void

interface MacroMutationContext {
  update: (callback: (items: CommandItem[]) => CommandItem[]) => void
  setFailure: SetMacroFailure
  source: symbol
}

async function loadMacros(
  setMacros: (update: CommandItem[]) => void,
  setFailure: SetMacroFailure,
) {
  try {
    setMacros((await MacroService.List() ?? []).map(macroItem))
    setFailure(null)
  } catch (error: unknown) {
    logger.error('Sidebar: list macros error', error)
    setMacros([])
    setFailure({ message: macroErrorMessage(error), kind: 'load' })
  }
}

async function addMacro(
  item: Omit<CommandItem, 'id'>,
  context: MacroMutationContext,
) {
  try {
    await runMacroMutation(async () => {
      const input = { name: item.name, command: item.command, shortcut: item.shortcut, id: 0, delay_ms: 0, sort_order: 0 } satisfies MacroInput
      const result = await MacroService.Create(input)
      context.update((items) => [...items, { id: String(result?.id ?? ''), name: result?.name ?? item.name, shortcut: result?.shortcut ?? item.shortcut, command: result?.command ?? item.command }])
      context.setFailure(null)
      emitMacroCatalogChanged(context.source)
    })
  } catch (error: unknown) {
    logger.error('Sidebar: create macro error', error)
    context.setFailure({ message: t('创建宏失败: ${}', macroErrorMessage(error)), kind: 'action' })
    throw error instanceof Error ? error : new Error(macroErrorMessage(error))
  }
}

async function deleteMacro(
  id: string,
  context: MacroMutationContext,
) {
  try {
    await runMacroMutation(async () => {
      await MacroService.Delete(Number(id))
      context.update((items) => items.filter((item) => item.id !== id))
      context.setFailure(null)
      emitMacroCatalogChanged(context.source)
    })
  } catch (error: unknown) {
    logger.error('Sidebar: delete macro error', error)
    context.setFailure({ message: t('删除宏失败: ${}', macroErrorMessage(error)), kind: 'action' })
    throw error instanceof Error ? error : new Error(macroErrorMessage(error))
  }
}

type SidebarMacroRuntime = ReturnType<typeof useSidebarMacroRuntime>

function useSidebarMacroLoader(runtime: SidebarMacroRuntime) {
  const [macros, setMacros] = useState<CommandItem[]>([])
  const [error, setError] = useState<MacroFailure | null>(null)
  const reload = useCallback(async (options?: { allowDuringMutation?: boolean }) => {
    if (!options?.allowDuringMutation && isMacroMutationActive()) return
    const lifecycleToken = runtime.lifecycle.current
    const request = ++runtime.listRequest.current
    const errorToken = ++runtime.errorRequest.current
    const isCurrent = () => runtime.lifecycle.current === lifecycleToken && runtime.listRequest.current === request
    await loadMacros(
      (items) => { if (isCurrent()) setMacros(items) },
      (message) => { if (isCurrent() && runtime.errorRequest.current === errorToken) setError(message) },
    )
  }, [])
  useEffect(() => { void reload() }, [reload])
  useEffect(() => onMacroCatalogChanged(runtime.source.current, () => { void reload({ allowDuringMutation: true }) }), [reload, runtime.source])
  return { macros, setMacros, error, setError, reload }
}

function macroMutationContext(runtime: SidebarMacroRuntime, setMacros: (update: (items: CommandItem[]) => CommandItem[]) => void, setError: SetMacroFailure) {
  const lifecycleToken = runtime.lifecycle.current
  const request = ++runtime.errorRequest.current
  runtime.listRequest.current++
  const isMounted = () => runtime.lifecycle.current === lifecycleToken
  return {
    source: runtime.source.current,
    update: (update: (items: CommandItem[]) => CommandItem[]) => { if (isMounted()) setMacros(update) },
    setFailure: (message: MacroFailure | null) => { if (isMounted() && runtime.errorRequest.current === request) setError(message) },
  }
}

function useSidebarMacroActions(runtime: SidebarMacroRuntime, setMacros: (update: (items: CommandItem[]) => CommandItem[]) => void, setError: SetMacroFailure) {
  const execute = useCallback((command: string) => {
    const lifecycleToken = runtime.lifecycle.current
    const request = ++runtime.errorRequest.current
    void executeMacroOnActiveTerminal(command, { requireTerminalSurface: true }).catch((error: unknown) => {
      if (runtime.lifecycle.current === lifecycleToken && runtime.errorRequest.current === request) {
        setError({ message: t('执行宏失败: ${}', macroErrorMessage(error)), kind: 'action' })
      }
    })
  }, [])
  const add = useCallback((item: Omit<CommandItem, 'id'>) => addMacro(item, macroMutationContext(runtime, setMacros, setError)), [])
  const remove = useCallback((id: string) => deleteMacro(id, macroMutationContext(runtime, setMacros, setError)), [])
  return { execute, add, remove }
}

export function useSidebarMacros() {
  const mutationBusy = useMacroMutationState((state) => state.busy)
  const runtime = useSidebarMacroRuntime()
  const loader = useSidebarMacroLoader(runtime)
  const actions = useSidebarMacroActions(runtime, loader.setMacros, loader.setError)
  const { macros, error, reload } = loader
  const { execute, add, remove } = actions
  return { macros, error, mutationBusy, reload, execute, add, remove }
}

function useSidebarMacroRuntime() {
  const lifecycle = useRef(0)
  const listRequest = useRef(0)
  const errorRequest = useRef(0)
  const source = useRef(Symbol('sidebar-macros'))
  useEffect(() => {
    const token = ++lifecycle.current
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [])
  return { lifecycle, listRequest, errorRequest, source }
}
