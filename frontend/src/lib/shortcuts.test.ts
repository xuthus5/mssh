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
    expect(bindings['terminal-search']).toEqual({ ctrl: true, meta: false, alt: false, shift: true, key: 'f' })
  })

  it('migrates legacy quick-search Ctrl+F bindings to the split shortcuts', () => {
    const bindings = normalizeShortcutBindings({
      'quick-search': 'Mod+F',
      'new-session': 'Mod+N',
    })
    expect(bindings['quick-search']).toEqual({ ctrl: true, meta: false, alt: false, shift: true, key: 's' })
    expect(bindings['terminal-search']).toEqual({ ctrl: true, meta: false, alt: false, shift: true, key: 'f' })
    expect(bindings['new-session']).toEqual({ ctrl: true, meta: false, alt: false, shift: true, key: 't' })
  })

  it('migrates terminal-conflicting plain Ctrl defaults to Ctrl+Shift variants', () => {
    const bindings = normalizeShortcutBindings({
      'new-session': 'Mod+N',
      'close-tab': 'Mod+W',
      'quick-search': 'Mod+S',
      'terminal-search': 'Mod+F',
    })
    expect(bindings['new-session']).toEqual({ ctrl: true, meta: false, alt: false, shift: true, key: 't' })
    expect(bindings['close-tab']).toEqual({ ctrl: true, meta: false, alt: false, shift: true, key: 'w' })
    expect(bindings['quick-search']).toEqual({ ctrl: true, meta: false, alt: false, shift: true, key: 's' })
    expect(bindings['terminal-search']).toEqual({ ctrl: true, meta: false, alt: false, shift: true, key: 'f' })
  })

  it('keeps custom plain-Ctrl bindings that differ from the old defaults', () => {
    const bindings = normalizeShortcutBindings({
      'close-tab': 'Mod+Alt+X',
      'quick-search': 'Mod+F',
      'terminal-search': 'Mod+Shift+F',
    })
    expect(bindings['close-tab']).toEqual({ ctrl: true, meta: false, alt: true, shift: false, key: 'x' })
    expect(bindings['quick-search']).toEqual({ ctrl: true, meta: false, alt: false, shift: false, key: 'f' })
    expect(bindings['terminal-search']).toEqual({ ctrl: true, meta: false, alt: false, shift: true, key: 'f' })
  })

  it('keeps an explicit Ctrl+F quick-search binding once terminal-search is persisted', () => {
    const bindings = normalizeShortcutBindings({
      'quick-search': 'Mod+F',
      'terminal-search': 'Mod+Shift+F',
    })
    expect(bindings['quick-search']).toEqual({ ctrl: true, meta: false, alt: false, shift: false, key: 'f' })
    expect(bindings['terminal-search']).toEqual({ ctrl: true, meta: false, alt: false, shift: true, key: 'f' })
  })

  it('detects conflicts between two actions', () => {
    const bindings = defaultShortcutBindings()
    bindings['new-session'] = parseChord('Mod+Shift+C')
    const conflicts = findShortcutConflicts(bindings)
    expect(conflicts.some((item) => item.actionId === 'new-session' && item.conflictsWith === 'copy-selection')).toBe(true)
  })

  it('matches action ids from events', () => {
    const bindings = defaultShortcutBindings()
    expect(matchShortcutAction({ key: 's', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true }, bindings)).toBe('quick-search')
    expect(matchShortcutAction({ key: 'f', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true }, bindings)).toBe('terminal-search')
    expect(matchShortcutAction({ key: 'w', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true }, bindings)).toBe('close-tab')
    expect(matchShortcutAction({ key: 'c', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true }, bindings)).toBe('copy-selection')
    expect(matchShortcutAction({ key: 's', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }, bindings)).toBeNull()
  })

  it('formats display for platforms', () => {
    const chord = parseChord('Mod+Shift+C')
    expect(formatChordDisplay(chord, 'other')).toBe('Ctrl+Shift+C')
    expect(formatChordDisplay(chord, 'mac')).toBe('⌘⇧C')
    expect(formatChordDisplay(null)).toBe('—')
  })

  it('serializes bindings for persistence', () => {
    const payload = serializeShortcutBindings(defaultShortcutBindings())
    expect(payload['new-session']).toBe('Mod+Shift+T')
    expect(payload['close-tab']).toBe('Mod+Shift+W')
    expect(payload['quick-search']).toBe('Mod+Shift+S')
    expect(payload['terminal-search']).toBe('Mod+Shift+F')
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
