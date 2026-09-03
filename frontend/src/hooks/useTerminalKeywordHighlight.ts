import type { TerminalRuntimeErrorReporter } from '@/components/terminal/TerminalErrorBoundary'
import { TerminalKeywordHighlighter, type KeywordRuleInput } from '@/lib/terminalKeywordHighlighter'
import { useTerminalKeywordHighlightStore, type KeywordHighlightSettings } from '@/store/terminalKeywordHighlightStore'

export interface TerminalKeywordHighlightController {
  transform: (data: Uint8Array) => Uint8Array
  flush: () => Uint8Array
  hasPending: () => boolean
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

function joinBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.length === 0) return right
  if (right.length === 0) return left
  const joined = new Uint8Array(left.length + right.length)
  joined.set(left)
  joined.set(right, left.length)
  return joined
}

interface KeywordHighlightRuntimeState {
  enabled: boolean
  signature: string
  pendingOutput: Uint8Array
  highlighter: TerminalKeywordHighlighter
  reportRuntimeError: TerminalRuntimeErrorReporter
}

function retainBufferedOutput(state: KeywordHighlightRuntimeState): void {
  try {
    state.pendingOutput = joinBytes(state.pendingOutput, state.highlighter.flush())
  } catch (error: unknown) {
    state.reportRuntimeError(error, 'keyword highlight')
  }
}

function updateKeywordSettings(state: KeywordHighlightRuntimeState, settings: KeywordHighlightSettings): void {
  const nextSignature = settingsSignature(settings)
  if (nextSignature === state.signature) return
  if (state.enabled && !settings.enabled) retainBufferedOutput(state)
  state.signature = nextSignature
  state.enabled = settings.enabled
  state.highlighter.applyConfig(toRuleInputs(settings), settings.caseInsensitive)
}

function transformKeywordOutput(state: KeywordHighlightRuntimeState, data: Uint8Array): Uint8Array {
  const prefix = state.pendingOutput
  state.pendingOutput = new Uint8Array(0)
  if (!state.enabled) return joinBytes(prefix, data)
  try {
    return joinBytes(prefix, state.highlighter.push(data, true))
  } catch (error: unknown) {
    state.reportRuntimeError(error, 'keyword highlight')
    return joinBytes(prefix, data)
  }
}

function flushKeywordOutput(state: KeywordHighlightRuntimeState): Uint8Array {
  const prefix = state.pendingOutput
  state.pendingOutput = new Uint8Array(0)
  if (!state.enabled) return prefix
  try {
    return joinBytes(prefix, state.highlighter.flush())
  } catch (error: unknown) {
    state.reportRuntimeError(error, 'keyword highlight')
    return prefix
  }
}

export function createTerminalKeywordHighlightController({
  reportRuntimeError,
}: TerminalKeywordHighlightOptions): TerminalKeywordHighlightController {
  const initial = useTerminalKeywordHighlightStore.getState()
  const state: KeywordHighlightRuntimeState = {
    enabled: initial.enabled,
    signature: settingsSignature(initial),
    pendingOutput: new Uint8Array(0),
    highlighter: new TerminalKeywordHighlighter(toRuleInputs(initial), initial.caseInsensitive),
    reportRuntimeError,
  }
  const unsubscribe = useTerminalKeywordHighlightStore.subscribe((settings) => updateKeywordSettings(state, settings))

  return {
    transform: (data) => transformKeywordOutput(state, data),
    flush: () => flushKeywordOutput(state),
    hasPending: () => state.pendingOutput.length > 0 || (state.enabled && state.highlighter.hasPending()),
    dispose: () => unsubscribe(),
  }
}
