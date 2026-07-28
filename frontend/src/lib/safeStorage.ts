type StorageArea = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function localStorageArea(): StorageArea | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    return null
  }
}

export function readStorageItem(key: string): string | null {
  try {
    return localStorageArea()?.getItem(key) ?? null
  } catch {
    return null
  }
}

export function readStorageNumber(key: string, fallback: number): number {
  const stored = readStorageItem(key)
  if (stored === null || stored.trim() === '') return fallback
  const parsed = Number(stored)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function writeStorageItem(key: string, value: string): boolean {
  try {
    const storage = localStorageArea()
    if (!storage) return false
    storage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function removeStorageItem(key: string): boolean {
  try {
    const storage = localStorageArea()
    if (!storage) return false
    storage.removeItem(key)
    return true
  } catch {
    return false
  }
}
