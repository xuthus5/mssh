import { describe, expect, it } from 'vitest'
import { defaultShortcutBindings } from '@/lib/shortcuts'
import { isOrdinaryEditableTarget, resolveShortcutAction } from '@/lib/shortcutRuntime'

describe('shortcutRuntime', () => {
  it('blocks shortcuts in ordinary editable fields', () => {
    const input = document.createElement('input')
    expect(isOrdinaryEditableTarget(input)).toBe(true)
    const event = new KeyboardEvent('keydown', { key: 'n', ctrlKey: true })
    Object.defineProperty(event, 'target', { value: input })
    expect(resolveShortcutAction(event, defaultShortcutBindings())).toBeNull()
  })

  it('allows shortcuts in xterm helper textarea', () => {
    const area = document.createElement('textarea')
    area.className = 'xterm-helper-textarea'
    const event = new KeyboardEvent('keydown', { key: 'n', ctrlKey: true })
    Object.defineProperty(event, 'target', { value: area })
    expect(resolveShortcutAction(event, defaultShortcutBindings())).toBe('new-session')
  })

  it('ignores recorder elements as ordinary editables', () => {
    const button = document.createElement('button')
    button.setAttribute('data-shortcut-recorder', 'true')
    expect(isOrdinaryEditableTarget(button)).toBe(false)
  })
})
