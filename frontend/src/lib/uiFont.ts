export const DEFAULT_UI_FONT_FAMILY = 'Geist Variable'
export const DEFAULT_UI_FONT_SIZE = 14
export const MIN_UI_FONT_SIZE = 12
export const MAX_UI_FONT_SIZE = 24

export interface UIFontSettings {
  family: string
  size: number
}

export function normalizeUIFontFamily(fontFamily: string): string {
  const normalized = fontFamily.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 128)
  return normalized || DEFAULT_UI_FONT_FAMILY
}

export function clampUIFontSize(fontSize: number): number {
  if (!Number.isFinite(fontSize)) return DEFAULT_UI_FONT_SIZE
  return Math.min(MAX_UI_FONT_SIZE, Math.max(MIN_UI_FONT_SIZE, Math.round(fontSize)))
}

export function applyUIFont(settings: UIFontSettings) {
  const family = normalizeUIFontFamily(settings.family)
  document.documentElement.style.setProperty('--app-font-family', `${JSON.stringify(family)}, sans-serif`)
  document.documentElement.style.setProperty('--app-font-size', `${clampUIFontSize(settings.size)}px`)
}
