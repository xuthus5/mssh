import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialogs } from '@wailsio/runtime'
import type { ThemeActionRunner } from '@/components/settings/ThemeManagerRow'
import type { ThemeImportSummary, ThemeProfile, ThemeProfileInput } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { t } from '@/i18n'

export interface ThemeManagerProps {
  profiles: ThemeProfile[]
  onImport: (paths: string[]) => Promise<ThemeImportSummary>
  onDeleteProfile: (id: number) => Promise<void> | void
  onDeleteDefinition: (id: number) => Promise<void> | void
  onCreateProfile: (input: ThemeProfileInput) => Promise<unknown> | unknown
  onUpdateProfile: (input: ThemeProfileInput) => Promise<void> | void
}

const referencedDefinitionError = /theme definition is referenced by \d+ profiles/

function useThemeManagerState(profiles: ThemeProfile[]) {
  const [query, setQuery] = useState('')
  const [summary, setSummary] = useState<ThemeImportSummary | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ThemeProfile | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [actionError, setActionError] = useState('')
  const [rowErrors, setRowErrors] = useState<ReadonlyMap<number, string>>(() => new Map())
  const [deleteError, setDeleteError] = useState('')
  const [importing, setImporting] = useState(false)
  const [pendingRows, setPendingRows] = useState<ReadonlySet<number>>(() => new Set())
  const lifecycle = useRef(0)
  const actionRequest = useRef(0)
  const importRequest = useRef(0)
  const importActive = useRef(false)
  const activeActions = useRef(new Set<number>())
  const deleteGeneration = useRef(0)
  const deleteRequest = useRef(0)
  const deleteActive = useRef(false)
  const windowGeneration = useRef(0)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [])
  const filtered = useMemo(() => profiles.filter((profile) => profile.name.toLowerCase().includes(query.toLowerCase())), [profiles, query])
  return { query, setQuery, summary, setSummary, deleteTarget, setDeleteTarget, deleting, setDeleting, actionError, setActionError, rowErrors, setRowErrors, deleteError, setDeleteError, importing, setImporting, pendingRows, setPendingRows, lifecycle, actionRequest, importRequest, importActive, activeActions, deleteGeneration, deleteRequest, deleteActive, windowGeneration, filtered }
}

type ThemeManagerState = ReturnType<typeof useThemeManagerState>

function useThemeActionRunner(state: ThemeManagerState): ThemeActionRunner {
  return async (profileID, action, onSuccess) => {
    if (state.importActive.current || state.deleteActive.current || state.activeActions.current.has(profileID)) return
    state.activeActions.current.add(profileID)
    state.setPendingRows((current) => new Set(current).add(profileID))
    state.setRowErrors((current) => withoutMapKey(current, profileID))
    const lifecycleToken = state.lifecycle.current
    const windowToken = state.windowGeneration.current
    const isCurrent = () => state.lifecycle.current === lifecycleToken && state.windowGeneration.current === windowToken
    try {
      state.setActionError('')
      await action()
      if (isCurrent()) onSuccess?.()
    } catch (error) {
      if (isCurrent()) {
        const message = t('主题操作失败: ${}', error instanceof Error ? error.message : String(error))
        state.setRowErrors((current) => new Map(current).set(profileID, message))
      }
    } finally {
      state.activeActions.current.delete(profileID)
      if (state.lifecycle.current === lifecycleToken) {
        state.setPendingRows((current) => {
          const next = new Set(current)
          next.delete(profileID)
          return next
        })
      }
    }
  }
}

function useThemeImport(props: ThemeManagerProps, state: ThemeManagerState) {
  return async () => {
    if (state.importActive.current || state.deleteActive.current || state.activeActions.current.size > 0) return
    state.importActive.current = true
    const lifecycleToken = state.lifecycle.current
    const windowToken = state.windowGeneration.current
    const request = ++state.importRequest.current
    const feedback = ++state.actionRequest.current
    const isImportCurrent = () => state.lifecycle.current === lifecycleToken && state.importRequest.current === request
    const isCurrent = () => isImportCurrent() && state.windowGeneration.current === windowToken && state.actionRequest.current === feedback
    let imported = false
    state.setImporting(true)
    state.setActionError('')
    try {
      const selected = await Dialogs.OpenFile({ Title: t('导入 iTerm2 终端主题'), CanChooseFiles: true, CanChooseDirectories: false, AllowsMultipleSelection: true, Filters: [{ DisplayName: 'iTerm2 Color Schemes', Pattern: '*.itermcolors' }] })
      const paths = typeof selected === 'string' ? [selected] : selected ?? []
      if (paths.length === 0 || !isCurrent()) return
      imported = true
      const summary = await props.onImport(paths)
      if (isCurrent()) state.setSummary(summary)
    } catch (error) {
      if (isCurrent()) state.setActionError(t(imported ? '导入主题失败: ${}' : '选择主题文件失败: ${}', error instanceof Error ? error.message : String(error)))
    } finally {
      if (isImportCurrent()) {
        state.importActive.current = false
        state.setImporting(false)
      }
    }
  }
}

async function maybeDeleteOrphanDefinition(profile: ThemeProfile, onDeleteDefinition: ThemeManagerProps['onDeleteDefinition']): Promise<string> {
  if (!profile.definition || profile.definition.is_builtin) return ''
  try {
    await onDeleteDefinition(profile.definition.id)
    return ''
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return referencedDefinitionError.test(message) ? '' : message
  }
}

function useThemeDeletion(props: ThemeManagerProps, state: ThemeManagerState) {
  const confirmDelete = async () => {
    if (!state.deleteTarget || state.deleteActive.current) return
    state.deleteActive.current = true
    const lifecycleToken = state.lifecycle.current
    const windowToken = state.windowGeneration.current
    const generation = state.deleteGeneration.current
    const request = ++state.deleteRequest.current
    const isLatest = () => state.lifecycle.current === lifecycleToken && state.deleteRequest.current === request
    const isCurrent = () => isLatest() && state.windowGeneration.current === windowToken && state.deleteGeneration.current === generation
    const target = state.deleteTarget
    state.setDeleting(true)
    try {
      state.setActionError('')
      state.setDeleteError('')
      await props.onDeleteProfile(target.id)
      const cleanupError = await maybeDeleteOrphanDefinition(target, props.onDeleteDefinition)
      if (isCurrent()) {
        state.setDeleteTarget(null)
        if (cleanupError) state.setActionError(t('主题配置已删除，但清理颜色定义失败: ${}', cleanupError))
      }
    } catch (error) {
      if (isCurrent()) state.setDeleteError(t('主题操作失败: ${}', error instanceof Error ? error.message : String(error)))
    } finally {
      if (isLatest()) {
        state.deleteActive.current = false
        state.setDeleting(false)
      }
    }
  }
  return confirmDelete
}

function createDeleteControls(state: ThemeManagerState) {
  const requestDelete = (profile: ThemeProfile) => {
    if (state.deleteActive.current || state.importActive.current || state.activeActions.current.size > 0) return
    state.deleteGeneration.current++
    state.setDeleteError('')
    state.setDeleteTarget(profile)
  }
  const handleDeleteOpenChange = (open: boolean) => {
    if (open || state.deleteActive.current) return
    state.deleteGeneration.current++
    state.setDeleteTarget(null)
    state.setDeleteError('')
  }
  return { requestDelete, handleDeleteOpenChange }
}

function dismissTransientState(state: ThemeManagerState) {
  state.windowGeneration.current++
  state.deleteGeneration.current++
  state.setDeleteTarget(null)
  state.setDeleteError('')
  state.setActionError('')
  state.setRowErrors(new Map())
}

function withoutMapKey<K, V>(source: ReadonlyMap<K, V>, key: K) {
  if (!source.has(key)) return source
  const next = new Map(source)
  next.delete(key)
  return next
}

export function useThemeManagerRuntime(props: ThemeManagerProps) {
  const state = useThemeManagerState(props.profiles)
  const runAction = useThemeActionRunner(state)
  const importFiles = useThemeImport(props, state)
  const confirmDelete = useThemeDeletion(props, state)
  return { ...state, runAction, importFiles, confirmDelete, dismissTransientState: () => dismissTransientState(state), ...createDeleteControls(state) }
}

export type ThemeManagerRuntime = ReturnType<typeof useThemeManagerRuntime>
