import { describe, expect, it } from 'vitest'
import {
  chordFromKeyboardEvent,
  chordsEqual,
  defaultShortcutBindings,
  eventMatchesChord,
  findShortcutConflicts,
  formatChordDisplay,
  isReservedShortcutChord,
  matchShortcutAction,
  normalizeShortcutBindings,
  parseChord,
  reservedShortcutReason,
  serializeChord,
  serializeShortcutBindings,
} from '@/lib/shortcuts'

describe('shortcuts', () => {
  it('serializes and parses chords with Mod alias', () => {
    const chord = parseChord('Mod+Shift+C')
    expect(chord).toEqual({ ctrl: true, meta: false, alt: false, shift: true, key: 'c' })
    expect(serializeChord(chord)).toBe('Mod+Shift+C')
    expect(parseChord(null)).toBeNull()
    expect(parseChord('')).toBeNull()
  })

  it('matches ctrl and meta interchangeably as Mod', () => {
    const chord = parseChord('Mod+N')
    expect(eventMatchesChord({ key: 'n', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }, chord)).toBe(true)
    expect(eventMatchesChord({ key: 'n', ctrlKey: false, metaKey: true, altKey: false, shiftKey: false }, chord)).toBe(true)
    expect(eventMatchesChord({ key: 'n', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true }, chord)).toBe(false)
  })

  it('ignores pure modifier events when building chords', () => {
    expect(chordFromKeyboardEvent({ key: 'Control', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBeNull()
  })

  it('normalizes partial binding maps to defaults', () => {
    const bindings = normalizeShortcutBindings({ 'new-session': 'Mod+Shift+S', 'close-tab': null })
    expect(bindings['new-session']).toEqual({ ctrl: true, meta: false, alt: false, shift: true, key: 's' })
    expect(bindings['close-tab']).toBeNull()
    expect(bindings['copy-selection']).toEqual(defaultShortcutBindings()['copy-selection'])
  })

  it('detects conflicts between two actions', () => {
    const bindings = defaultShortcutBindings()
    bindings['new-session'] = parseChord('Mod+Shift+C')
    const conflicts = findShortcutConflicts(bindings)
    expect(conflicts.some((item) => item.actionId === 'new-session' && item.conflictsWith === 'copy-selection')).toBe(true)
  })

  it('matches action ids from events', () => {
    const bindings = defaultShortcutBindings()
    expect(matchShortcutAction({ key: 'f', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }, bindings)).toBe('quick-search')
    expect(matchShortcutAction({ key: 'c', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true }, bindings)).toBe('copy-selection')
  })

  it('formats display for platforms', () => {
    const chord = parseChord('Mod+Shift+C')
    expect(formatChordDisplay(chord, 'other')).toBe('Ctrl+Shift+C')
    expect(formatChordDisplay(chord, 'mac')).toBe('⌘⇧C')
    expect(formatChordDisplay(null)).toBe('—')
  })

  it('serializes bindings for persistence', () => {
    const payload = serializeShortcutBindings(defaultShortcutBindings())
    expect(payload['new-session']).toBe('Mod+N')
    expect(payload['copy-selection']).toBe('Mod+Shift+C')
  })

  it('compares chords by Mod semantics', () => {
    expect(chordsEqual(
      { ctrl: true, meta: false, alt: false, shift: false, key: 'n' },
      { ctrl: false, meta: true, alt: false, shift: false, key: 'n' },
    )).toBe(true)
  })
})

describe('reserved shortcut chords', () => {
  it('flags OS-reserved combinations', () => {
    expect(isReservedShortcutChord({ ctrl: true, meta: false, alt: false, shift: false, key: 'q' })).toBe(true)
    expect(isReservedShortcutChord({ ctrl: true, meta: false, alt: false, shift: false, key: 'n' })).toBe(false)
    expect(reservedShortcutReason({ ctrl: false, meta: false, alt: true, shift: false, key: 'f4' })).toContain('系统保留')
  })

  it('strips reserved chords during normalize', () => {
    const normalized = normalizeShortcutBindings({
      'new-session': 'Mod+Q',
      'close-tab': 'Mod+W',
    })
    expect(normalized['new-session']).toBeNull()
    expect(normalized['close-tab']).toMatchObject({ key: 'w' })
  })
})
