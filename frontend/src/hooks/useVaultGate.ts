import { useCallback, useEffect, useRef, useState } from 'react'
import { Dialogs, Events } from '@wailsio/runtime'
import { SecurityService, SyncService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { validateAppPassword } from '@/lib/appPassword'
import { t } from '@/i18n'
import { syncDataChangedEvent } from '@/lib/syncDataReload'
import { useSettingsWindowHide } from '@/hooks/useSettingsWindowHide'
import type { SecurityStatus } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'

const emptyStatus: SecurityStatus = {
  configured: false,
  unlocked: false,
  require_password_on_launch: false,
  remember_unlock: true,
  updated_at: '',
}

const vaultLockedEvent = 'security:vault-locked'
const vaultChangedEvent = 'security:vault-changed'
const vaultRememberFailedEvent = 'security:remember-failed'

export type GateMode = 'loading' | 'setup' | 'unlock' | 'ready' | 'error'
type VaultOperation = (isCurrent: () => boolean) => Promise<boolean | void>

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function useVaultState() {
  const [status, setStatus] = useState<SecurityStatus>(emptyStatus)
  const [mode, setMode] = useState<GateMode>('loading')
  const [error, setError] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [requireLaunch, setRequireLaunch] = useState(false)
  const [rememberUnlock, setRememberUnlock] = useState(true)
  const [busy, setBusy] = useState(false)
  const [restoreMode, setRestoreMode] = useState(false)
  const [rememberWarning, setRememberWarning] = useState('')
  return {
    status, setStatus, mode, setMode, error, setError, password, setPassword,
    confirmPassword, setConfirmPassword, requireLaunch, setRequireLaunch,
    rememberUnlock, setRememberUnlock, busy, setBusy, restoreMode, setRestoreMode,
    rememberWarning, setRememberWarning,
  }
}

type VaultState = ReturnType<typeof useVaultState>

function useVaultRuntime() {
  const lifecycle = useRef(0)
  const statusRequest = useRef(0)
  const operationRequest = useRef(0)
  const operationGeneration = useRef(0)
  const busyRef = useRef(false)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => {
      if (lifecycle.current === token) lifecycle.current++
    }
  }, [])
  return { lifecycle, statusRequest, operationRequest, operationGeneration, busyRef }
}

type VaultRuntime = ReturnType<typeof useVaultRuntime>

function useVaultStatus(state: VaultState, runtime: VaultRuntime) {
  const { setError, setMode, setRememberUnlock, setRequireLaunch, setStatus, setRememberWarning } = state
  const { lifecycle, statusRequest } = runtime
  const applyStatus = useCallback((next: SecurityStatus) => {
    setStatus(next)
    setRequireLaunch(next.require_password_on_launch)
    setRememberUnlock(next.remember_unlock)
    setMode(!next.configured ? 'setup' : !next.unlocked ? 'unlock' : 'ready')
    if (next.remember_unlock) setRememberWarning('')
  }, [setMode, setRememberUnlock, setRequireLaunch, setStatus, setRememberWarning])
  const refresh = useCallback(async () => {
    const lifecycleToken = lifecycle.current
    const request = ++statusRequest.current
    const isCurrent = () => lifecycle.current === lifecycleToken && statusRequest.current === request
    if (!isCurrent()) return false
    setError('')
    try {
      const next = await SecurityService.Status()
      if (!isCurrent()) return false
      applyStatus(next)
      return true
    } catch (refreshError) {
      if (!isCurrent()) return false
      logger.error('load vault status failed', refreshError)
      setMode('error')
      setError(errorMessage(refreshError))
      return false
    }
  }, [applyStatus, lifecycle, setError, setMode, statusRequest])
  return refresh
}

function useClearSecrets(state: VaultState) {
  const { setConfirmPassword, setPassword, setRestoreMode } = state
  return useCallback(() => {
    setPassword('')
    setConfirmPassword('')
    setRestoreMode(false)
  }, [setConfirmPassword, setPassword, setRestoreMode])
}

interface VaultRunnerOptions {
  state: VaultState
  runtime: VaultRuntime
  refresh: () => Promise<boolean>
  clearSecrets: () => void
}

function useVaultRunner({ state, runtime, refresh, clearSecrets }: VaultRunnerOptions) {
  const { setBusy, setError } = state
  const { busyRef, lifecycle, operationGeneration, operationRequest } = runtime
  return useCallback(async (operation: VaultOperation) => {
    if (busyRef.current) return
    const lifecycleToken = lifecycle.current
    const generationToken = operationGeneration.current
    const request = ++operationRequest.current
    const isLatest = () => lifecycle.current === lifecycleToken && operationRequest.current === request
    const isCurrent = () => isLatest() && operationGeneration.current === generationToken
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      const shouldRefresh = await operation(isCurrent)
      if (!isCurrent() || shouldRefresh === false) return
      clearSecrets()
      await refresh()
    } catch (operationError) {
      if (isCurrent()) setError(errorMessage(operationError))
    } finally {
      if (isLatest()) {
        busyRef.current = false
        setBusy(false)
      }
    }
  }, [busyRef, clearSecrets, lifecycle, operationGeneration, operationRequest, refresh, setBusy, setError])
}

function useInvalidateOperation(runtime: VaultRuntime) {
  const { operationGeneration } = runtime
  return useCallback(() => {
    operationGeneration.current++
  }, [operationGeneration])
}

function useInvalidatePending(runtime: VaultRuntime) {
  const invalidateOperation = useInvalidateOperation(runtime)
  const { statusRequest } = runtime
  const invalidateAll = useCallback(() => {
    statusRequest.current++
    invalidateOperation()
  }, [invalidateOperation, statusRequest])
  return { invalidateAll, invalidateOperation }
}

interface VaultEventsOptions {
  state: VaultState
  refresh: () => Promise<boolean>
  clearSecrets: () => void
  invalidatePending: () => void
}

function useVaultEvents({ state, refresh, clearSecrets, invalidatePending }: VaultEventsOptions) {
  const { setError, setMode, setStatus, setRememberWarning } = state
  useEffect(() => {
    const stopLocked = Events.On(vaultLockedEvent, () => {
      invalidatePending()
      setMode('unlock')
      setStatus((current) => ({ ...current, unlocked: false }))
      clearSecrets()
      setError('')
      void refresh()
    })
    const stopChanged = Events.On(vaultChangedEvent, () => {
      invalidatePending()
      clearSecrets()
      void refresh()
    })
    const stopSync = Events.On(syncDataChangedEvent, () => {
      invalidatePending()
      void refresh()
    })
    const stopRememberFailed = Events.On(vaultRememberFailedEvent, (event) => {
      const message = typeof event?.data?.message === 'string' && event.data.message ? event.data.message : ''
      const notice = message || t('无法在系统钥匙串中保存解锁状态，下次启动仍将要求输入密码')
      setError(notice)
      setRememberWarning(notice)
    })
    return () => { stopLocked(); stopChanged(); stopSync(); stopRememberFailed() }
  }, [clearSecrets, invalidatePending, refresh, setError, setMode, setRememberWarning, setStatus])
}

function useVaultPasswordActions(state: VaultState, run: (operation: VaultOperation) => Promise<void>) {
  const { confirmPassword, password, rememberUnlock, requireLaunch, setError } = state
  const setup = useCallback(() => {
    const validationError = validateAppPassword(password)
    if (validationError) return setError(t(validationError))
    if (password !== confirmPassword) return setError(t('两次输入的密码不一致'))
    void run(() => SecurityService.Setup({
      password, require_password_on_launch: requireLaunch, remember_unlock: rememberUnlock,
    }).then(() => undefined))
  }, [confirmPassword, password, rememberUnlock, requireLaunch, run, setError])
  const unlock = useCallback(() => {
    if (!password) return setError(t('请输入应用密码'))
    const validationError = validateAppPassword(password, false)
    if (validationError) return setError(t(validationError))
    void run(() => SecurityService.Unlock({ password, remember_unlock: rememberUnlock }).then(() => undefined))
  }, [password, rememberUnlock, run, setError])
  return { setup, unlock }
}

function useVaultRestoreActions(state: VaultState, runtime: VaultRuntime, run: (operation: VaultOperation) => Promise<void>) {
  const { password, setConfirmPassword, setError, setRestoreMode } = state
  const restoreFromBackup = useCallback(() => {
    const validationError = validateAppPassword(password)
    if (validationError) return setError(t(validationError))
    void run(async (isCurrent) => {
      const selected = await Dialogs.OpenFile({
        Title: t('选择加密备份'), CanChooseFiles: true, CanChooseDirectories: false,
        AllowsMultipleSelection: false, Filters: [{ DisplayName: 'mssh backup', Pattern: '*.msshbackup' }],
      })
      if (!isCurrent()) return false
      const path = Array.isArray(selected) ? selected[0] : selected
      if (!path) return false
      await SyncService.ImportWithPassword(path, password)
      return true
    })
  }, [password, run, setError])
  const enterRestoreMode = useCallback(() => {
    if (runtime.busyRef.current) return
    setRestoreMode(true)
    setConfirmPassword('')
    setError('')
  }, [runtime.busyRef, setConfirmPassword, setError, setRestoreMode])
  const exitRestoreMode = useCallback(() => {
    if (!runtime.busyRef.current) setRestoreMode(false)
  }, [runtime.busyRef, setRestoreMode])
  return { restoreFromBackup, enterRestoreMode, exitRestoreMode }
}

interface UseVaultGateOptions {
  clearOnSettingsHide?: boolean
}

export function useVaultGate({ clearOnSettingsHide = false }: UseVaultGateOptions = {}) {
  const state = useVaultState()
  const runtime = useVaultRuntime()
  const refresh = useVaultStatus(state, runtime)
  const clearSecrets = useClearSecrets(state)
  const clearRememberWarning = useCallback(() => state.setRememberWarning(''), [state])
  const run = useVaultRunner({ state, runtime, refresh, clearSecrets })
  const { invalidateAll, invalidateOperation } = useInvalidatePending(runtime)
  useSettingsWindowHide(useCallback(() => {
    invalidateOperation()
    clearSecrets()
    state.setError('')
  }, [clearSecrets, invalidateOperation, state.setError]), clearOnSettingsHide)
  useEffect(() => { void refresh() }, [refresh])
  useVaultEvents({ state, refresh, clearSecrets, invalidatePending: invalidateAll })
  const passwordActions = useVaultPasswordActions(state, run)
  const restoreActions = useVaultRestoreActions(state, runtime, run)
  return {
    status: state.status, mode: state.mode, error: state.error,
    password: state.password, setPassword: state.setPassword,
    confirmPassword: state.confirmPassword, setConfirmPassword: state.setConfirmPassword,
    requireLaunch: state.requireLaunch, setRequireLaunch: state.setRequireLaunch,
    rememberUnlock: state.rememberUnlock, setRememberUnlock: state.setRememberUnlock,
    busy: state.busy, restoreMode: state.restoreMode, refresh,
    rememberWarning: state.rememberWarning, clearRememberWarning,
    ...passwordActions, ...restoreActions,
  }
}
