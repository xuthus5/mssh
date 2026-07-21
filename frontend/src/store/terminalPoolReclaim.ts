import { TerminalService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import { unregisterTerminalSearch } from '@/lib/terminalSearchRegistry'
import {
  clearTerminalRuntimeFields,
  confirmProtectedTerminalReclaim,
  describeTerminalPoolVictim,
  findTabByTerminalID,
  selectTerminalPoolEvictionID,
  type TerminalPoolVictim,
} from '@/store/terminalPool'
import type { AppState } from '@/store/appStore'
import {
  fallbackAfterClose,
  type ActiveSurface,
  type WorkspaceID,
} from '@/store/tabNavigation'
import { t } from '@/i18n'


function workspaceTabForSurface(activeSurface: ActiveSurface | null, workspaceTab: WorkspaceID): WorkspaceID {
  return activeSurface?.type === 'workspace' ? activeSurface.id : workspaceTab
}

/** Dispose frontend xterm resources for a pool victim (FE-PERF-005). */
export function disposePooledTerminal(state: AppState, terminalID: string): void {
  const entry = state.terminalPool.get(terminalID)
  unregisterTerminalSearch(terminalID)
  if (!entry) return
  try {
    entry.terminal.dispose()
  } catch (error: unknown) {
    logger.error('dispose pooled terminal failed', { terminalID, error })
  }
}

function removeOwningTabState(state: AppState, tabID: string, terminalPool: AppState['terminalPool']): Partial<AppState> {
  const activeSurface = state.activeSurface?.id === tabID ? fallbackAfterClose(state.tabs, tabID) : state.activeSurface
  return {
    tabs: state.tabs.filter((tab) => tab.id !== tabID),
    terminalPool,
    activeSurface,
    workspaceTab: workspaceTabForSurface(activeSurface, state.workspaceTab),
  }
}

/** Apply one eviction to store state. Orphans dispose here; tab-bound dispose on React unmount. */
export function applyTerminalPoolEviction(state: AppState, victimID: string): Partial<AppState> {
  const owningTab = findTabByTerminalID(state.tabs, victimID)
  if (!owningTab) disposePooledTerminal(state, victimID)
  else unregisterTerminalSearch(victimID)
  const terminalPool = new Map(state.terminalPool)
  terminalPool.delete(victimID)
  const runtime = clearTerminalRuntimeFields(state, victimID)
  void TerminalService.Close(victimID).catch((error: unknown) => {
    logger.error('evict terminal: close backend error', { terminalID: victimID, error })
  })
  if (!owningTab) return { terminalPool, ...runtime }
  return { ...removeOwningTabState(state, owningTab.id, terminalPool), ...runtime }
}

export function announceTerminalPoolReclaim(victim: TerminalPoolVictim): void {
  if (!victim.owningTab) {
    toast(t('已释放空闲终端实例以腾出连接池'), 'info')
    return
  }
  toast(
    t('已关闭标签「${}」以腾出终端池。可从会话列表重新连接该会话。', victim.owningTab.title),
    'warning',
  )
}

export type TerminalPoolStoreAccess = {
  getState: () => AppState
  setState: (partial: Partial<AppState>) => void
}

export type EnsureTerminalPoolCapacityOptions = TerminalPoolStoreAccess & {
  confirmProtected?: (victim: TerminalPoolVictim) => boolean
  reserve?: number
}

/**
 * Ensure the frontend terminal pool has room before opening a backend terminal.
 * Orphans reclaim without confirm; open-tab victims require confirm + recovery toast.
 */
export function ensureTerminalPoolCapacity(options: EnsureTerminalPoolCapacityOptions): boolean {
  const confirmProtected = options.confirmProtected
    ?? ((victim) => confirmProtectedTerminalReclaim(victim))
  const reserve = Math.max(1, options.reserve ?? 1)

  while (true) {
    const state = options.getState()
    if (state.terminalPool.size + reserve - 1 < state.maxPoolSize) return true

    const orphanID = selectTerminalPoolEvictionID(state, 'orphan-only')
    if (orphanID) {
      const victim = describeTerminalPoolVictim(state, orphanID)
      options.setState(applyTerminalPoolEviction(state, orphanID))
      announceTerminalPoolReclaim(victim)
      continue
    }

    const protectedID = selectTerminalPoolEvictionID(state, 'include-protected')
    if (!protectedID) return false
    const victim = describeTerminalPoolVictim(state, protectedID)
    if (victim.protected && !confirmProtected(victim)) {
      toast(t('已取消打开新终端：终端池已满且未释放现有标签'), 'info')
      return false
    }
    options.setState(applyTerminalPoolEviction(state, protectedID))
    announceTerminalPoolReclaim(victim)
  }
}

export async function openTerminalWithPoolCapacity(
  open: () => Promise<string>,
  store: TerminalPoolStoreAccess,
  options?: Omit<EnsureTerminalPoolCapacityOptions, keyof TerminalPoolStoreAccess>,
): Promise<string> {
  if (!ensureTerminalPoolCapacity({ ...store, ...options })) {
    throw new Error(t('终端池已满，用户取消释放现有终端'))
  }
  return open()
}
