/** Application shortcut action identifiers. */
export type ShortcutActionId =
  | 'new-session'
  | 'new-local-terminal'
  | 'close-tab'
  | 'quick-search'
  | 'copy-selection'
  | 'paste-clipboard'
  | 'clear-terminal'

export interface ShortcutChord {
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
  /** Lowercase key from KeyboardEvent.key for letters/digits, or special names like Escape. */
  key: string
}

export interface ShortcutDefinition {
  id: ShortcutActionId
  /** Chinese source label for i18n. */
  label: string
  /** Chinese source description. */
  description: string
  /** When true, shortcut still fires inside ordinary form fields (rare). */
  allowInEditable?: boolean
  /** Default binding; null means unbound. */
  defaultChord: ShortcutChord | null
}

export type ShortcutBindings = Record<ShortcutActionId, ShortcutChord | null>

export const SHORTCUT_SETTING_KEY = 'application.shortcuts'
export const SHORTCUTS_CHANGED_EVENT = 'settings:shortcuts-changed'

export const SHORTCUT_DEFINITIONS: readonly ShortcutDefinition[] = [
  {
    id: 'new-session',
    label: '新建会话',
    description: '打开新建 SSH 会话流程。',
    defaultChord: { ctrl: true, meta: false, alt: false, shift: false, key: 'n' },
  },
  {
    id: 'new-local-terminal',
    label: '本地终端',
    description: '打开一个本机交互 Shell 终端。',
    defaultChord: { ctrl: true, meta: false, alt: false, shift: true, key: 'n' },
  },
  {
    id: 'close-tab',
    label: '关闭标签页',
    description: '关闭当前活动标签（活动连接需手动确认）。',
    defaultChord: { ctrl: true, meta: false, alt: false, shift: false, key: 'w' },
  },
  {
    id: 'quick-search',
    label: '快速搜索会话',
    description: '打开会话快速搜索面板。',
    allowInEditable: false,
    defaultChord: { ctrl: true, meta: false, alt: false, shift: false, key: 'f' },
  },
  {
    id: 'copy-selection',
    label: '复制',
    description: '复制当前终端选中文本。',
    defaultChord: { ctrl: true, meta: false, alt: false, shift: true, key: 'c' },
  },
  {
    id: 'paste-clipboard',
    label: '粘贴',
    description: '将剪贴板内容粘贴到当前终端。',
    defaultChord: { ctrl: true, meta: false, alt: false, shift: true, key: 'v' },
  },
  {
    id: 'clear-terminal',
    label: '清屏',
    description: '清空当前终端可见内容。',
    defaultChord: { ctrl: true, meta: false, alt: false, shift: true, key: 'l' },
  },
] as const

export function defaultShortcutBindings(): ShortcutBindings {
  return Object.fromEntries(
    SHORTCUT_DEFINITIONS.map((item) => [item.id, item.defaultChord ? { ...item.defaultChord } : null]),
  ) as ShortcutBindings
}

export function shortcutDefinition(id: ShortcutActionId): ShortcutDefinition {
  const found = SHORTCUT_DEFINITIONS.find((item) => item.id === id)
  if (!found) throw new Error(`unknown shortcut action: ${id}`)
  return found
}

function normalizeKey(key: string): string {
  if (key === ' ') return 'space'
  if (key.length === 1) return key.toLowerCase()
  return key
}

/** Build a chord from a keyboard event. Returns null for pure modifier presses. */
export function chordFromKeyboardEvent(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): ShortcutChord | null {
  const key = event.key
  if (key === 'Control' || key === 'Meta' || key === 'Alt' || key === 'Shift') return null
  return {
    ctrl: event.ctrlKey,
    meta: event.metaKey,
    alt: event.altKey,
    shift: event.shiftKey,
    key: normalizeKey(key),
  }
}

/** Canonical storage form: Mod stands for Ctrl/Meta platform command key. */
export function serializeChord(chord: ShortcutChord | null): string | null {
  if (!chord) return null
  const parts: string[] = []
  const mod = chord.ctrl || chord.meta
  if (mod) parts.push('Mod')
  if (chord.alt) parts.push('Alt')
  if (chord.shift) parts.push('Shift')
  const key = chord.key.length === 1 ? chord.key.toUpperCase() : chord.key
  parts.push(key === ' ' ? 'Space' : key)
  return parts.join('+')
}

export function parseChord(raw: unknown): ShortcutChord | null {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw !== 'string') return null
  const tokens = raw.split('+').map((part) => part.trim()).filter(Boolean)
  if (tokens.length === 0) return null
  let ctrl = false
  let meta = false
  let alt = false
  let shift = false
  let key = ''
  for (const token of tokens) {
    const upper = token.toUpperCase()
    if (upper === 'MOD' || upper === 'CTRL' || upper === 'CONTROL' || upper === 'CMD' || upper === 'COMMAND' || upper === 'META' || upper === '⌘') {
      ctrl = true
      continue
    }
    if (upper === 'ALT' || upper === 'OPTION' || upper === '⌥') {
      alt = true
      continue
    }
    if (upper === 'SHIFT' || upper === '⇧') {
      shift = true
      continue
    }
    key = token === 'Space' || token === 'space' ? 'space' : normalizeKey(token)
  }
  if (!key) return null
  return { ctrl, meta: false, alt, shift, key }
}

export function chordsEqual(a: ShortcutChord | null, b: ShortcutChord | null): boolean {
  if (a === null && b === null) return true
  if (!a || !b) return false
  const aMod = a.ctrl || a.meta
  const bMod = b.ctrl || b.meta
  return aMod === bMod && a.alt === b.alt && a.shift === b.shift && a.key === b.key
}

/** Match event against stored chord; Ctrl and Meta are interchangeable as Mod. */
export function eventMatchesChord(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, chord: ShortcutChord | null): boolean {
  if (!chord) return false
  const eventChord = chordFromKeyboardEvent(event)
  if (!eventChord) return false
  return chordsEqual(eventChord, chord)
}

export function formatChordDisplay(chord: ShortcutChord | null, platform: 'mac' | 'other' = detectShortcutPlatform()): string {
  if (!chord) return '—'
  const parts: string[] = []
  const mod = chord.ctrl || chord.meta
  if (mod) parts.push(platform === 'mac' ? '⌘' : 'Ctrl')
  if (chord.alt) parts.push(platform === 'mac' ? '⌥' : 'Alt')
  if (chord.shift) parts.push(platform === 'mac' ? '⇧' : 'Shift')
  const key = chord.key === 'space' ? 'Space' : chord.key.length === 1 ? chord.key.toUpperCase() : chord.key
  parts.push(key)
  return parts.join(platform === 'mac' ? '' : '+')
}

export function detectShortcutPlatform(): 'mac' | 'other' {
  if (typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)) return 'mac'
  return 'other'
}

export function normalizeShortcutBindings(value: unknown): ShortcutBindings {
  const defaults = defaultShortcutBindings()
  if (!value || typeof value !== 'object') return defaults
  const record = value as Record<string, unknown>
  const next = { ...defaults }
  for (const definition of SHORTCUT_DEFINITIONS) {
    if (!(definition.id in record)) continue
    const raw = record[definition.id]
    if (raw === null) {
      next[definition.id] = null
      continue
    }
    if (typeof raw === 'string') {
      next[definition.id] = parseChord(raw)
      continue
    }
    if (raw && typeof raw === 'object') {
      const object = raw as Partial<ShortcutChord>
      const chord: ShortcutChord = {
        ctrl: Boolean(object.ctrl || object.meta),
        meta: false,
        alt: Boolean(object.alt),
        shift: Boolean(object.shift),
        key: normalizeKey(String(object.key ?? '')),
      }
      next[definition.id] = chord.key ? chord : null
    }
  }
  return next
}

export function serializeShortcutBindings(bindings: ShortcutBindings): Record<string, string | null> {
  return Object.fromEntries(
    SHORTCUT_DEFINITIONS.map((item) => [item.id, serializeChord(bindings[item.id] ?? null)]),
  ) as Record<string, string | null>
}

export function findShortcutConflicts(bindings: ShortcutBindings): Array<{ actionId: ShortcutActionId; conflictsWith: ShortcutActionId }> {
  const conflicts: Array<{ actionId: ShortcutActionId; conflictsWith: ShortcutActionId }> = []
  const ids = SHORTCUT_DEFINITIONS.map((item) => item.id)
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const left = ids[i]
      const right = ids[j]
      if (chordsEqual(bindings[left], bindings[right]) && bindings[left] !== null) {
        conflicts.push({ actionId: left, conflictsWith: right })
        conflicts.push({ actionId: right, conflictsWith: left })
      }
    }
  }
  return conflicts
}

export function matchShortcutAction(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
  bindings: ShortcutBindings,
): ShortcutActionId | null {
  for (const definition of SHORTCUT_DEFINITIONS) {
    if (eventMatchesChord(event, bindings[definition.id])) return definition.id
  }
  return null
}
