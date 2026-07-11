export const DEFAULT_WINDOW_OPACITY = 100
export const MIN_WINDOW_OPACITY = 50
export const MAX_WINDOW_OPACITY = 100

export function clampWindowOpacity(opacity: number): number {
  if (!Number.isFinite(opacity)) return DEFAULT_WINDOW_OPACITY
  return Math.min(MAX_WINDOW_OPACITY, Math.max(MIN_WINDOW_OPACITY, Math.round(opacity)))
}

export function applyWindowOpacity(opacity: number) {
  document.documentElement.style.setProperty('--app-opacity', (clampWindowOpacity(opacity) / 100).toString())
}
