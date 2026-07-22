import { SESSION_QUICK_SEARCH_EVENT } from '@/lib/sessionQuickSearch'

export const APP_NEW_SESSION_EVENT = 'mssh:new-session' as const
export const APP_NEW_LOCAL_TERMINAL_EVENT = 'mssh:new-local-terminal' as const
export const APP_SESSION_QUICK_SEARCH_EVENT = SESSION_QUICK_SEARCH_EVENT

export type AppEventName = typeof APP_NEW_SESSION_EVENT | typeof APP_NEW_LOCAL_TERMINAL_EVENT | typeof SESSION_QUICK_SEARCH_EVENT

export function emitAppEvent(name: AppEventName): void {
  window.dispatchEvent(new CustomEvent(name))
}

export function onAppEvent(name: AppEventName, handler: () => void): () => void {
  const listener = () => handler()
  window.addEventListener(name, listener)
  return () => window.removeEventListener(name, listener)
}
