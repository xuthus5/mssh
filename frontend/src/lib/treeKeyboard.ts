export type TreeNavKey = 'ArrowUp' | 'ArrowDown' | 'Home' | 'End' | 'ArrowLeft' | 'ArrowRight' | 'Enter' | ' '

export function nextTreeIndex(current: number, key: TreeNavKey, count: number): number | null {
  if (count <= 0) return null
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  if (key === 'ArrowDown') return Math.min(count - 1, Math.max(0, current) + 1)
  if (key === 'ArrowUp') return Math.max(0, (current < 0 ? 0 : current) - 1)
  return null
}

export function isTreeNavigationKey(key: string): key is TreeNavKey {
  return key === 'ArrowUp' || key === 'ArrowDown' || key === 'Home' || key === 'End'
    || key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Enter' || key === ' '
}
