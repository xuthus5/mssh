import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { Events } from '@wailsio/runtime'
import { SettingService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import {
  SHORTCUT_SETTING_KEY,
  SHORTCUTS_CHANGED_EVENT,
  defaultShortcutBindings,
  normalizeShortcutBindings,
  serializeShortcutBindings,
  type ShortcutBindings,
} from '@/lib/shortcuts'
import { settingEntry } from '@/hooks/useGeneralSettings'
import { useShortcutStore } from '@/store/shortcutStore'
import { syncDataChangedEvent } from '@/lib/syncDataReload'

interface EventEnvelope<T> { data?: T }

async function loadPersistedBindings(): Promise<{ bindings: ShortcutBindings; error: string }> {
  try {
    const entry = await SettingService.Get(SHORTCUT_SETTING_KEY)
    if (!entry?.value) return { bindings: defaultShortcutBindings(), error: '' }
    const parsed = JSON.parse(entry.value) as unknown
    return { bindings: normalizeShortcutBindings(parsed), error: '' }
  } catch (error: unknown) {
    logger.error('load shortcuts failed', error)
    return {
      bindings: defaultShortcutBindings(),
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function persistBindings(bindings: ShortcutBindings): Promise<void> {
  await SettingService.Set(settingEntry(SHORTCUT_SETTING_KEY, serializeShortcutBindings(bindings)))
}

function applyBindings(bindings: ShortcutBindings) {
  useShortcutStore.getState().setBindings(bindings)
  useShortcutStore.getState().markSettingsHydrated()
}

function useShortcutRequestRuntime() {
  const lifecycle = useRef(0)
  const requestID = useRef(0)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [])
  return { lifecycle, requestID }
}

function useShortcutEventSync({ reload, requestID, setBindings, setError, setLoading }: {
  reload: () => Promise<void>
  requestID: MutableRefObject<number>
  setBindings: (bindings: ShortcutBindings) => void
  setError: (error: string) => void
  setLoading: (loading: boolean) => void
}) {
  useEffect(() => {
    void reload()
    const stop = Events.On(SHORTCUTS_CHANGED_EVENT, (event: EventEnvelope<ShortcutBindings>) => {
      if (!event.data) return
      requestID.current++
      const normalized = normalizeShortcutBindings(event.data)
      setBindings(normalized)
      applyBindings(normalized)
      setError('')
      setLoading(false)
    })
    const stopSync = Events.On(syncDataChangedEvent, () => { void reload() })
    return () => { stop(); stopSync() }
  }, [reload, requestID, setBindings, setError, setLoading])
}

export function useShortcutSettings() {
  const [bindings, setBindings] = useState<ShortcutBindings>(() => useShortcutStore.getState().bindings)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const { lifecycle, requestID } = useShortcutRequestRuntime()

  const reload = useCallback(async () => {
    const lifecycleToken = lifecycle.current
    const currentRequest = ++requestID.current
    const next = await loadPersistedBindings()
    if (lifecycle.current !== lifecycleToken || requestID.current !== currentRequest) return
    setBindings(next.bindings)
    applyBindings(next.bindings)
    setError(next.error)
    setLoading(false)
  }, [])

  useShortcutEventSync({ reload, requestID, setBindings, setError, setLoading })

  const saveBindings = useCallback(async (next: ShortcutBindings, options?: { quiet?: boolean }) => {
    const normalized = normalizeShortcutBindings(next)
    try {
      await persistBindings(normalized)
      requestID.current++
      setBindings(normalized)
      applyBindings(normalized)
      void Events.Emit(SHORTCUTS_CHANGED_EVENT, normalized).catch((error: unknown) => {
        logger.error('emit shortcuts changed failed', error)
      })
    } catch (error: unknown) {
      logger.error('save shortcuts failed', error)
      // Shortcut panel owns failures via AutoSaveStatusIndicator / thrown errors.
      throw error
    }
  }, [])

  return { bindings, loading, error, saveBindings, reload }
}

/** Hydrate shortcuts in the main window runtime (no UI). */
export function useShortcutRuntimeHydration() {
  useEffect(() => {
    let cancelled = false
    let revision = 0
    const reload = () => {
      const request = ++revision
      void loadPersistedBindings().then((next) => {
        if (cancelled || request !== revision) return
        applyBindings(next.bindings)
      })
    }
    reload()
    const stop = Events.On(SHORTCUTS_CHANGED_EVENT, (event: EventEnvelope<ShortcutBindings>) => {
      if (!event.data) return
      revision++
      applyBindings(normalizeShortcutBindings(event.data))
    })
    const stopSync = Events.On(syncDataChangedEvent, reload)
    return () => {
      cancelled = true
      revision++
      stop()
      stopSync()
    }
  }, [])
}
