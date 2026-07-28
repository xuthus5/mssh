import { create } from 'zustand'
import { t } from '@/i18n'
import { OperationBusyError } from '@/lib/operationBusyError'

interface MacroMutationState {
  busy: boolean
}

interface MacroCatalogChange {
  source: symbol
}

const macroCatalogChangedEvent = 'mssh:macro-catalog-changed'
let mutationActive = false

export const useMacroMutationState = create<MacroMutationState>(() => ({ busy: false }))

export function isMacroMutationActive() {
  return mutationActive
}

export async function runMacroMutation<T>(operation: () => Promise<T>): Promise<T> {
  if (mutationActive) throw new OperationBusyError(t('宏操作正在进行'))
  mutationActive = true
  useMacroMutationState.setState({ busy: true })
  try {
    return await operation()
  } finally {
    mutationActive = false
    useMacroMutationState.setState({ busy: false })
  }
}

export function emitMacroCatalogChanged(source: symbol) {
  window.dispatchEvent(new CustomEvent<MacroCatalogChange>(macroCatalogChangedEvent, { detail: { source } }))
}

export function onMacroCatalogChanged(source: symbol, handler: () => void) {
  const listener = (event: Event) => {
    if ((event as CustomEvent<MacroCatalogChange>).detail?.source !== source) handler()
  }
  window.addEventListener(macroCatalogChangedEvent, listener)
  return () => window.removeEventListener(macroCatalogChangedEvent, listener)
}

export function resetMacroMutationCoordinator() {
  mutationActive = false
  useMacroMutationState.setState({ busy: false })
}
