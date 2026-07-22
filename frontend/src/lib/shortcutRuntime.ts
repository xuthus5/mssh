import {
  matchShortcutAction,
  shortcutDefinition,
  type ShortcutActionId,
  type ShortcutBindings,
} from '@/lib/shortcuts'

export function isOrdinaryEditableTarget(target: HTMLElement | null): boolean {
  if (!target?.matches('input, textarea, select, [contenteditable="true"]')) return false
  if (target.classList.contains('xterm-helper-textarea')) return false
  if (target.hasAttribute('data-session-search-input')) return false
  if (target.hasAttribute('data-shortcut-recorder')) return false
  return true
}

export function resolveShortcutAction(
  event: KeyboardEvent,
  bindings: ShortcutBindings,
): ShortcutActionId | null {
  const actionId = matchShortcutAction(event, bindings)
  if (!actionId) return null
  const definition = shortcutDefinition(actionId)
  const target = event.target as HTMLElement | null
  if (!definition.allowInEditable && isOrdinaryEditableTarget(target)) return null
  // quick-search uses a slightly broader rule: allow unless ordinary editable
  if (actionId === 'quick-search' && isOrdinaryEditableTarget(target)) return null
  return actionId
}
