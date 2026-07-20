export const DEFAULT_WINDOW_OPACITY = 100
export const MIN_WINDOW_OPACITY = 50
export const MAX_WINDOW_OPACITY = 100

export type WindowOpacityPlatform = 'windows' | 'mac' | 'linux' | 'other'
type ApplicationWindowRole = 'main' | 'settings'

export function clampWindowOpacity(opacity: number): number {
  if (!Number.isFinite(opacity)) return DEFAULT_WINDOW_OPACITY
  return Math.min(MAX_WINDOW_OPACITY, Math.max(MIN_WINDOW_OPACITY, Math.round(opacity)))
}

export function applyWindowOpacity(opacity: number) {
  const clamped = clampWindowOpacity(opacity)
  const alpha = (clamped / 100).toString()
  const root = document.documentElement
  const windowRole = detectApplicationWindowRole()
  root.style.setProperty('--app-opacity', alpha)
  root.style.setProperty('--app-background-alpha', windowRole === 'settings' ? '1' : alpha)
  root.dataset.windowOpacity = String(clamped)
  root.dataset.windowRole = windowRole
}

function detectApplicationWindowRole(): ApplicationWindowRole {
  return new URLSearchParams(window.location.search).get('window') === 'settings' ? 'settings' : 'main'
}

export function detectWindowOpacityPlatform(): WindowOpacityPlatform {
  const agent = navigator.userAgent.toLowerCase()
  if (agent.includes('windows')) return 'windows'
  if (agent.includes('mac os') || agent.includes('macintosh')) return 'mac'
  if (agent.includes('linux')) return 'linux'
  return 'other'
}

export function isNativeWindowOpacitySupported(platform: WindowOpacityPlatform = detectWindowOpacityPlatform()): boolean {
  return platform === 'windows' || platform === 'mac'
}

export function windowOpacitySupportMessage(platform: WindowOpacityPlatform = detectWindowOpacityPlatform()): string {
  if (isNativeWindowOpacitySupported(platform)) {
    return '通过原生半透明窗口与半透明背景实现。Windows 使用 Acrylic，macOS 使用毛玻璃背景。'
  }
  return '当前 Linux 桌面下 Wails 原生窗口透明尚未可靠生效，设置会保存但可能看不到桌面透出效果。'
}
