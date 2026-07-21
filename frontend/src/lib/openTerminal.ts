import { useAppStore } from '@/store/appStore'
import {
  ensureTerminalPoolCapacity,
  openTerminalWithPoolCapacity as openWithCapacity,
  type EnsureTerminalPoolCapacityOptions,
  type TerminalPoolStoreAccess,
} from '@/store/terminalPoolReclaim'

function appStoreAccess(): TerminalPoolStoreAccess {
  return {
    getState: () => useAppStore.getState(),
    setState: (partial) => { useAppStore.setState(partial) },
  }
}

/** Open a backend terminal after reclaiming pool capacity with confirm/recovery rules. */
export function openTerminalWithPoolCapacity(
  open: () => Promise<string>,
  options?: Omit<EnsureTerminalPoolCapacityOptions, keyof TerminalPoolStoreAccess>,
): Promise<string> {
  return openWithCapacity(open, appStoreAccess(), options)
}

export function ensureAppTerminalPoolCapacity(
  options?: Omit<EnsureTerminalPoolCapacityOptions, keyof TerminalPoolStoreAccess>,
): boolean {
  return ensureTerminalPoolCapacity({ ...appStoreAccess(), ...options })
}
