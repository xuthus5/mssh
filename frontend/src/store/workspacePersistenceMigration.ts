function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Upgrade older durable workspace snapshots into the current schema when possible. */
export function migrateWorkspaceSnapshot(value: unknown, currentVersion: number): unknown {
  if (!isRecord(value) || typeof value.version !== 'number') return value
  if (value.version === currentVersion) return value
  if (value.version === 1 && Array.isArray(value.tabs)) {
    return {
      ...value,
      version: currentVersion,
      tabs: value.tabs.map((tab) => {
        if (!isRecord(tab) || tab.type !== 'terminal') return tab
        const { split: _split, splitDirection: _direction, ...intent } = tab
        return intent
      }),
    }
  }
  if (value.version === 2 && Array.isArray(value.tabs)) {
    return {
      ...value,
      version: currentVersion,
      tabs: value.tabs.map((tab) => {
        if (!isRecord(tab) || tab.type !== 'terminal') return tab
        if (tab.connectionKind !== 'serial' || !('splitLayout' in tab)) return tab
        const { splitLayout: _drop, ...intent } = tab
        return intent
      }),
    }
  }
  return value
}
