import type { SearchAddon } from '@xterm/addon-search'

const searchAddons = new Map<string, SearchAddon>()
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

export function registerTerminalSearch(terminalID: string, addon: SearchAddon) {
  searchAddons.set(terminalID, addon)
  notify()
}

export function unregisterTerminalSearch(terminalID: string) {
  searchAddons.delete(terminalID)
  notify()
}

export function replaceTerminalSearch(previousID: string, nextID: string) {
  if (previousID === nextID) return
  const addon = searchAddons.get(previousID)
  if (!addon) return
  searchAddons.delete(previousID)
  searchAddons.set(nextID, addon)
  notify()
}

export function getTerminalSearch(terminalID: string) {
  return searchAddons.get(terminalID) ?? null
}

export function subscribeTerminalSearch(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
