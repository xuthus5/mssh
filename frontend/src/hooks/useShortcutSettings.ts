import { useCallback, useEffect, useState } from 'react'
import { Events } from '@wailsio/runtime'
import { SettingService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
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
import { t } from '@/i18n'

interface EventEnvelope<T> { data?: T }

async function loadPersistedBindings(): Promise<ShortcutBindings> {
  try {
    const entry = await SettingService.Get(SHORTCUT_SETTING_KEY)
    if (!entry?.value) return defaultShortcutBindings()
    const parsed = JSON.parse(entry.value) as unknown
    return normalizeShortcutBindings(parsed)
  } catch (error: unknown) {
    logger.error('load shortcuts failed', error)
    toast(t('加载快捷键失败: ${}', error instanceof Error ? error.message : String(error)), 'error')
    return defaultShortcutBindings()
  }
}

async function persistBindings(bindings: ShortcutBindings): Promise<void> {
  await SettingService.Set(settingEntry(SHORTCUT_SETTING_KEY, serializeShortcutBindings(bindings)))
}

function applyBindings(bindings: ShortcutBindings) {
  useShortcutStore.getState().setBindings(bindings)
  useShortcutStore.getState().markSettingsHydrated()
}

export function useShortcutSettings() {
  const [bindings, setBindings] = useState<ShortcutBindings>(() => useShortcutStore.getState().bindings)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    const next = await loadPersistedBindings()
    setBindings(next)
    applyBindings(next)
    setLoading(false)
  }, [])

  useEffect(() => {
    void reload()
    const stop = Events.On(SHORTCUTS_CHANGED_EVENT, (event: EventEnvelope<ShortcutBindings>) => {
      if (!event.data) return
      const normalized = normalizeShortcutBindings(event.data)
      setBindings(normalized)
      applyBindings(normalized)
    })
    return () => { stop() }
  }, [reload])

  const saveBindings = useCallback(async (next: ShortcutBindings) => {
    const normalized = normalizeShortcutBindings(next)
    try {
      await persistBindings(normalized)
      setBindings(normalized)
      applyBindings(normalized)
      void Events.Emit(SHORTCUTS_CHANGED_EVENT, normalized).catch((error: unknown) => {
        logger.error('emit shortcuts changed failed', error)
      })
    } catch (error: unknown) {
      logger.error('save shortcuts failed', error)
      toast(t('保存快捷键失败: ${}', error instanceof Error ? error.message : String(error)), 'error')
      throw error
    }
  }, [])

  return { bindings, loading, saveBindings, reload }
}

/** Hydrate shortcuts in the main window runtime (no UI). */
export function useShortcutRuntimeHydration() {
  useEffect(() => {
    let cancelled = false
    void loadPersistedBindings().then((bindings) => {
      if (cancelled) return
      applyBindings(bindings)
    })
    const stop = Events.On(SHORTCUTS_CHANGED_EVENT, (event: EventEnvelope<ShortcutBindings>) => {
      if (!event.data) return
      applyBindings(normalizeShortcutBindings(event.data))
    })
    return () => {
      cancelled = true
      stop()
    }
  }, [])
}
