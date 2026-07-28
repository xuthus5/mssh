import { useCallback, useEffect, useRef, useState } from 'react'
import { Events } from '@wailsio/runtime'
import { SecurityService, SessionService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'
import type { SecurityStatus } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { syncDataChangedEvent } from '@/lib/syncDataReload'

export type HostKeyEntry = { line: number; hosts: string; algorithm: string; fingerprint: string }

const emptyStatus: SecurityStatus = {
  configured: false,
  unlocked: false,
  require_password_on_launch: false,
  remember_unlock: true,
  updated_at: '',
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function useSecurityLifecycle() {
  const lifecycle = useRef(0)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => {
      if (lifecycle.current === token) lifecycle.current++
    }
  }, [])
  return useCallback(() => {
    const token = lifecycle.current
    return () => lifecycle.current === token
  }, [])
}

interface SecurityData {
  status: SecurityStatus
  entries: HostKeyEntry[]
  loading: boolean
  loadError: string
  load: () => Promise<boolean>
  loadAfterOperation: () => Promise<boolean>
  endOperation: () => void
}

function useSecurityEventReload(
  load: () => Promise<boolean>,
  operationActive: { current: boolean },
  eventRefreshPending: { current: boolean },
) {
  useEffect(() => {
    const reload = () => {
      if (operationActive.current) {
        eventRefreshPending.current = true
        return
      }
      void load()
    }
    const stopChanged = Events.On('security:vault-changed', reload)
    const stopLocked = Events.On('security:vault-locked', reload)
    const stopSync = Events.On(syncDataChangedEvent, reload)
    return () => { stopChanged(); stopLocked(); stopSync() }
  }, [eventRefreshPending, load, operationActive])
}

function useSecurityData(captureLifecycle: () => () => boolean, operationActive: { current: boolean }): SecurityData {
  const [status, setStatus] = useState<SecurityStatus>(emptyStatus)
  const [entries, setEntries] = useState<HostKeyEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const requestID = useRef(0)
  const eventRefreshPending = useRef(false)
  const load = useCallback(async () => {
    const isActive = captureLifecycle()
    const request = ++requestID.current
    if (!isActive()) return false
    setLoading(true)
    try {
      const [nextStatus, nextEntries] = await Promise.all([SecurityService.Status(), SessionService.ListHostKeys()])
      if (!isActive() || requestID.current !== request) return false
      setStatus(nextStatus)
      setEntries(nextEntries ?? [])
      setLoadError('')
      return true
    } catch (error) {
      if (!isActive() || requestID.current !== request) return false
      logger.error('load security settings failed', error)
      setLoadError(errorMessage(error))
      return false
    } finally {
      if (isActive() && requestID.current === request) setLoading(false)
    }
  }, [captureLifecycle])
  const loadAfterOperation = useCallback(async () => {
    let loaded = false
    do {
      eventRefreshPending.current = false
      loaded = await load()
    } while (eventRefreshPending.current)
    return loaded
  }, [load])
  const endOperation = useCallback(() => {
    operationActive.current = false
    if (!eventRefreshPending.current) return
    eventRefreshPending.current = false
    void load()
  }, [load, operationActive])
  useEffect(() => { void load() }, [load])
  useSecurityEventReload(load, operationActive, eventRefreshPending)
  return { status, entries, loading, loadError, load, loadAfterOperation, endOperation }
}

interface ActionRunnerOptions {
  captureLifecycle: () => () => boolean
  load: () => Promise<boolean>
  clearPasswords: () => void
  setFormError: (value: string) => void
  setActionError: (value: string) => void
  operationActive: { current: boolean }
  endOperation: () => void
}

function useSecurityActionRunner(options: ActionRunnerOptions) {
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const run = useCallback(async (success: string, failure: string, operation: () => Promise<unknown>) => {
    if (busyRef.current) return false
    const isActive = options.captureLifecycle()
    busyRef.current = true
    options.operationActive.current = true
    if (isActive()) {
      setBusy(true)
      options.setFormError('')
      options.setActionError('')
    }
    try {
      await operation()
      if (!isActive()) return false
      await options.load()
      if (!isActive()) return false
      toast(success, 'success')
      options.clearPasswords()
      return true
    } catch (error) {
      if (isActive()) options.setActionError(t(failure, errorMessage(error)))
      return false
    } finally {
      options.endOperation()
      busyRef.current = false
      if (isActive()) setBusy(false)
    }
  }, [options.captureLifecycle, options.clearPasswords, options.endOperation, options.load, options.operationActive,
    options.setActionError, options.setFormError])
  const canStart = useCallback(() => !busyRef.current, [])
  return { busy, canStart, run }
}

export function useSecurityPanel() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [requireLaunch, setRequireLaunch] = useState(false)
  const [rememberUnlock, setRememberUnlock] = useState(true)
  const [formError, setFormError] = useState('')
  const [actionError, setActionError] = useState('')
  const operationActive = useRef(false)
  const captureLifecycle = useSecurityLifecycle()
  const data = useSecurityData(captureLifecycle, operationActive)
  const clearPasswords = useCallback(() => {
    setPassword('')
    setConfirmPassword('')
    setCurrentPassword('')
    setNewPassword('')
    setConfirmNewPassword('')
  }, [])
  const resetTransientState = useCallback(() => {
    clearPasswords()
    setFormError('')
    setActionError('')
  }, [clearPasswords])
  useEffect(() => {
    setRequireLaunch(data.status.require_password_on_launch)
    setRememberUnlock(data.status.remember_unlock)
  }, [data.status])
  const runner = useSecurityActionRunner({
    captureLifecycle, load: data.loadAfterOperation, clearPasswords, setFormError, setActionError,
    operationActive, endOperation: data.endOperation,
  })
  return {
    ...data,
    ...runner,
    password, setPassword, confirmPassword, setConfirmPassword,
    currentPassword, setCurrentPassword, newPassword, setNewPassword,
    confirmNewPassword, setConfirmNewPassword, requireLaunch, setRequireLaunch,
    rememberUnlock, setRememberUnlock, formError, setFormError, actionError,
    resetTransientState,
  }
}
