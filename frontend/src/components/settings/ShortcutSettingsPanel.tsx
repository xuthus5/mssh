import { useCallback, useEffect, useMemo, useState } from 'react'
import { Keyboard, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AutoSaveStatusIndicator } from '@/components/settings/AutoSaveStatus'
import { useAutoSave } from '@/hooks/useAutoSave'
import { useShortcutSettings } from '@/hooks/useShortcutSettings'
import {
  SHORTCUT_DEFINITIONS,
  chordFromKeyboardEvent,
  defaultShortcutBindings,
  findShortcutConflicts,
  formatChordDisplay,
  type ShortcutActionId,
  type ShortcutBindings,
  type ShortcutChord,
} from '@/lib/shortcuts'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

function ShortcutRecorder({
  value,
  recording,
  onStart,
  onChange,
  onCancel,
}: {
  value: ShortcutChord | null
  recording: boolean
  onStart: () => void
  onChange: (chord: ShortcutChord | null) => void
  onCancel: () => void
}) {
  useEffect(() => {
    if (!recording) return
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        onCancel()
        return
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        onChange(null)
        return
      }
      const chord = chordFromKeyboardEvent(event)
      if (!chord) return
      // Require at least one modifier for letter/digit keys to avoid accidental capture.
      const hasMod = chord.ctrl || chord.meta || chord.alt || chord.shift
      if (!hasMod && chord.key.length === 1) return
      onChange(chord)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [recording, onCancel, onChange])

  return (
    <button
      type="button"
      data-shortcut-recorder="true"
      aria-label={t('录制快捷键')}
      className={cn(
        'min-w-36 rounded-lg border px-3 py-1.5 text-left text-xs font-medium transition-colors',
        recording
          ? 'border-primary bg-primary/10 text-primary ring-2 ring-primary/30'
          : 'border-border bg-background text-foreground hover:bg-muted/60',
      )}
      onClick={onStart}
    >
      {recording ? t('按下组合键…（Esc 取消）') : formatChordDisplay(value)}
    </button>
  )
}

export function ShortcutSettingsPanel() {
  const { bindings, loading, saveBindings } = useShortcutSettings()
  const [draft, setDraft] = useState<ShortcutBindings>(bindings)
  const [recordingId, setRecordingId] = useState<ShortcutActionId | null>(null)

  useEffect(() => {
    setDraft(bindings)
  }, [bindings])

  const conflicts = useMemo(() => findShortcutConflicts(draft), [draft])
  const conflictMap = useMemo(() => {
    const map = new Map<ShortcutActionId, ShortcutActionId[]>()
    for (const item of conflicts) {
      const list = map.get(item.actionId) ?? []
      list.push(item.conflictsWith)
      map.set(item.actionId, list)
    }
    return map
  }, [conflicts])

  const persist = useCallback(async (next: ShortcutBindings) => {
    await saveBindings(next)
  }, [saveBindings])

  const autoSave = useAutoSave({
    value: draft,
    onSave: persist,
    enabled: !loading && recordingId === null && conflicts.length === 0,
    isReady: !loading,
    delayMs: 450,
  })

  const updateBinding = (id: ShortcutActionId, chord: ShortcutChord | null) => {
    setDraft((current) => ({ ...current, [id]: chord }))
    setRecordingId(null)
  }

  const resetAll = () => {
    const next = defaultShortcutBindings()
    setDraft(next)
    setRecordingId(null)
    void persist(next)
  }

  return (
    <div className="flex flex-col gap-5 pt-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Keyboard className="size-4" />
            {t('快捷键')}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('自定义全局快捷键。修改后自动保存；冲突项会以警告标出。macOS 使用 ⌘，Windows/Linux 使用 Ctrl。')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoSaveStatusIndicator status={autoSave.status} error={autoSave.error} />
          <Button type="button" size="sm" variant="outline" onClick={resetAll}>
            <RotateCcw className="size-3.5" />
            {t('恢复默认')}
          </Button>
        </div>
      </div>

      {conflicts.length > 0 ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {t('存在快捷键冲突，已暂停自动保存。请先消除冲突后再继续。')}
        </div>
      ) : null}
      <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <div className="flex flex-col divide-y divide-border">
          {SHORTCUT_DEFINITIONS.map((definition) => {
            const conflictIds = conflictMap.get(definition.id) ?? []
            const conflictLabels = conflictIds
              .map((id) => SHORTCUT_DEFINITIONS.find((item) => item.id === id)?.label)
              .filter(Boolean)
              .map((label) => t(label as string))
            return (
              <div key={definition.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">{t(definition.label)}</div>
                  <div className="text-xs text-muted-foreground">{t(definition.description)}</div>
                  {conflictLabels.length > 0 && (
                    <div className="mt-1 text-xs text-destructive">
                      {t('与「${}」冲突', conflictLabels.join(' / '))}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <ShortcutRecorder
                    value={draft[definition.id]}
                    recording={recordingId === definition.id}
                    onStart={() => setRecordingId(definition.id)}
                    onCancel={() => setRecordingId(null)}
                    onChange={(chord) => updateBinding(definition.id, chord)}
                  />
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('清除快捷键')}
                    disabled={draft[definition.id] === null}
                    onClick={() => updateBinding(definition.id, null)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
