import type { TerminalRuntimeErrorReporter } from '@/components/terminal/TerminalErrorBoundary'
import { TerminalKeywordHighlighter, type KeywordRuleInput } from '@/lib/terminalKeywordHighlighter'
import { useTerminalKeywordHighlightStore, type KeywordHighlightSettings } from '@/store/terminalKeywordHighlightStore'

export interface TerminalKeywordHighlightController {
  transform: (data: Uint8Array) => Uint8Array
  flush: () => Uint8Array
  dispose: () => void
}

export interface TerminalKeywordHighlightOptions {
  reportRuntimeError: TerminalRuntimeErrorReporter
}

function toRuleInputs(settings: KeywordHighlightSettings): KeywordRuleInput[] {
  return settings.rules.map((rule) => ({ keyword: rule.keyword, color: rule.color }))
}

function settingsSignature(settings: KeywordHighlightSettings): string {
  const rules = settings.rules.map((rule) => `${rule.keyword}:${rule.color.toLocaleLowerCase()}`).join(',')
  return `${settings.enabled}|${settings.caseInsensitive}|${rules}`
}

export function createTerminalKeywordHighlightController({
  reportRuntimeError,
}: TerminalKeywordHighlightOptions): TerminalKeywordHighlightController {
  let current = useTerminalKeywordHighlightStore.getState()
  let enabled = current.enabled
  let signature = settingsSignature(current)
  const highlighter = new TerminalKeywordHighlighter(toRuleInputs(current), current.caseInsensitive)

  const unsubscribe = useTerminalKeywordHighlightStore.subscribe((state) => {
    const nextSignature = settingsSignature(state)
    if (nextSignature === signature) return
    signature = nextSignature
    enabled = state.enabled
    highlighter.applyConfig(toRuleInputs(state), state.caseInsensitive)
  })

  const transform = (data: Uint8Array): Uint8Array => {
    if (!enabled) return data
    try {
      return highlighter.push(data, true)
    } catch (error: unknown) {
      reportRuntimeError(error, 'keyword highlight')
      return data
    }
  }

  const flush = (): Uint8Array => {
    if (!enabled) return new Uint8Array(0)
    try {
      return highlighter.flush()
    } catch {
      return new Uint8Array(0)
    }
  }

  return { transform, flush, dispose: () => unsubscribe() }
}