import { useCallback, useEffect, useRef, useState } from 'react'
import { Events } from '@wailsio/runtime'
import { SettingService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { t } from '@/i18n'
import { syncDataChangedEvent } from '@/lib/syncDataReload'
import type { SettingInput } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'

export const HOST_KEY_CHANGE_POLICY_SETTING = 'security.host_key_change_policy'

export type HostKeyChangePolicy = 'block' | 'warn' | 'trust'

export function normalizeHostKeyChangePolicy(value: unknown): HostKeyChangePolicy {
  let raw = value
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed === 'string') raw = parsed
    } catch {
      // fall through to raw string comparison
    }
  }
  if (raw === 'warn' || raw === 'trust') return raw
  return 'block'
}

export function hostKeyChangePolicyOptions() {
  return [
    { value: 'block', label: t('阻止') },
    { value: 'warn', label: t('提醒') },
    { value: 'trust', label: t('默认信任') },
  ] as const
}

function hostKeyChangePolicySetting(value: HostKeyChangePolicy): SettingInput {
  return {
    key: HOST_KEY_CHANGE_POLICY_SETTING,
    namespace: 'security',
    value: JSON.stringify(value),
    value_type: 'string',
    version: 1,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function useHostKeyPolicyLifecycle() {
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

export function useHostKeyChangePolicy() {
  const [policy, setPolicy] = useState<HostKeyChangePolicy>('block')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const isActive = useHostKeyPolicyLifecycle()
  const requestID = useRef(0)
  const load = useCallback(async () => {
    const active = isActive()
    const request = ++requestID.current
    setLoading(true)
    try {
      const setting = await SettingService.Get(HOST_KEY_CHANGE_POLICY_SETTING)
      if (!active() || requestID.current !== request) return
      setPolicy(normalizeHostKeyChangePolicy(setting?.value))
      setError('')
    } catch (loadError) {
      if (!active() || requestID.current !== request) return
      logger.error('load host key change policy failed', loadError)
      setError(errorMessage(loadError))
    } finally {
      if (active() && requestID.current === request) setLoading(false)
    }
  }, [isActive])
  const save = useCallback(async (next: HostKeyChangePolicy) => {
    const active = isActive()
    const request = ++requestID.current
    setSaving(true)
    setError('')
    try {
      await SettingService.Set(hostKeyChangePolicySetting(next))
      if (!active() || requestID.current !== request) return
      setPolicy(next)
    } catch (saveError) {
      if (!active() || requestID.current !== request) return
      logger.error('save host key change policy failed', saveError)
      setError(t('保存指纹策略失败: ${}', errorMessage(saveError)))
      throw saveError
    } finally {
      if (active() && requestID.current === request) setSaving(false)
    }
  }, [isActive])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const reload = () => { void load() }
    const stop = Events.On(syncDataChangedEvent, reload)
    return () => { stop() }
  }, [load])
  return { policy, loading, saving, error, load, save }
}
