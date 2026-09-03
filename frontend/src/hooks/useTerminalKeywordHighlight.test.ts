import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTerminalKeywordHighlightController } from '@/hooks/useTerminalKeywordHighlight'
import { useTerminalKeywordHighlightStore } from '@/store/terminalKeywordHighlightStore'

function bytes(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => char.charCodeAt(0))
}

function text(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
}

function render(controller: ReturnType<typeof createTerminalKeywordHighlightController>, inputs: string[]): string {
  let output = ''
  for (const input of inputs) output += text(controller.transform(bytes(input)))
  return output + text(controller.flush())
}

const SGR = '\u001b[38;2;255;85;85m'

beforeEach(() => {
  useTerminalKeywordHighlightStore.getState().resetToDefault()
})

describe('createTerminalKeywordHighlightController', () => {
  it('highlights output with the default enabled rules', () => {
    const report = vi.fn()
    const controller = createTerminalKeywordHighlightController({ reportRuntimeError: report })
    const result = render(controller, ['an Error'])
    expect(result).toContain(`${SGR}Error\u001b[0m`)
    expect(report).not.toHaveBeenCalled()
  })

  it('becomes a pass-through when highlighting is disabled', () => {
    const controller = createTerminalKeywordHighlightController({ reportRuntimeError: vi.fn() })
    useTerminalKeywordHighlightStore.setState({ enabled: false, rules: [] })
    const result = render(controller, ['an Error'])
    expect(result).toContain('an Error')
    useTerminalKeywordHighlightStore.getState().resetToDefault()
    expect(text(controller.flush())).toBe('')
  })

  it('does not drop a buffered suffix when highlighting is disabled', () => {
    const controller = createTerminalKeywordHighlightController({ reportRuntimeError: vi.fn() })
    expect(text(controller.transform(bytes('cmd In')))).toBe('cmd ')

    useTerminalKeywordHighlightStore.setState({ enabled: false, rules: [] })

    expect(text(controller.flush())).toBe('In')
  })

  it('applies store rule changes without dropping buffered output', () => {
    const controller = createTerminalKeywordHighlightController({ reportRuntimeError: vi.fn() })
    const buffered = text(controller.transform(bytes('look ')))
    useTerminalKeywordHighlightStore.setState({ enabled: true, rules: [{ keyword: 'ERR', color: '#ff0000' }] })
    const output = buffered + render(controller, ['ERR'])
    expect(output).toContain('\u001b[38;2;255;0;0mERR\u001b[0m')
    expect(output).toContain('look ')
  })

  it('stops matching mixed case when the store disables case-insensitivity', () => {
    const controller = createTerminalKeywordHighlightController({ reportRuntimeError: vi.fn() })
    expect(render(controller, ['down ERROR'])).toContain(`${SGR}ERROR\u001b[0m`)
    useTerminalKeywordHighlightStore.setState({ enabled: true, caseInsensitive: false, rules: [{ keyword: 'Error', color: '#ff5555' }] })
    expect(render(controller, ['down ERROR'])).not.toContain(SGR)
    expect(render(controller, ['down Error'])).toContain(`${SGR}Error\u001b[0m`)
  })

  it('returns an empty flush result for empty input', () => {
    const report = vi.fn()
    const controller = createTerminalKeywordHighlightController({ reportRuntimeError: report })
    expect(controller.hasPending()).toBe(false)
    expect(controller.transform(new Uint8Array(0)).length).toBe(0)
    expect(controller.flush().length).toBe(0)
    controller.transform(bytes('cmd In'))
    expect(controller.hasPending()).toBe(true)
    controller.flush()
    expect(controller.hasPending()).toBe(false)
  })

  it('stops reacting to store changes after dispose', () => {
    const controller = createTerminalKeywordHighlightController({ reportRuntimeError: vi.fn() })
    controller.dispose()
    useTerminalKeywordHighlightStore.setState({ enabled: true, rules: [] })
    expect(text(controller.flush())).toBe('')
  })
})
