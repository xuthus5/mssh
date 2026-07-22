import { beforeEach, describe, expect, it } from 'vitest'
import { defaultShortcutBindings, parseChord } from '@/lib/shortcuts'
import { useShortcutStore } from '@/store/shortcutStore'

describe('shortcutStore', () => {
  beforeEach(() => {
    useShortcutStore.setState({
      bindings: defaultShortcutBindings(),
      settingsHydrated: false,
    })
  })

  it('updates a single binding', () => {
    useShortcutStore.getState().setBinding('new-session', parseChord('Mod+Shift+S'))
    expect(useShortcutStore.getState().bindings['new-session']).toEqual({
      ctrl: true, meta: false, alt: false, shift: true, key: 's',
    })
  })

  it('resets defaults', () => {
    useShortcutStore.getState().setBinding('close-tab', null)
    useShortcutStore.getState().resetDefaults()
    expect(useShortcutStore.getState().bindings).toEqual(defaultShortcutBindings())
  })
})
