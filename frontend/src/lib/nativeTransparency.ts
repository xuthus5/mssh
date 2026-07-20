import type { NativeTransparencyStatus as GeneratedNativeTransparencyStatus } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'

export type NativeTransparencyStatus = GeneratedNativeTransparencyStatus

export const DEFAULT_NATIVE_TRANSPARENCY_STATUS: NativeTransparencyStatus = {
  supported: false,
  active: false,
  platform: 'unknown',
  reason: '正在检测原生透明窗口能力',
  requires_restart: true,
}

export function applyNativeTransparencyStatus(status: NativeTransparencyStatus) {
  const settingsWindow = new URLSearchParams(window.location.search).get('window') === 'settings'
  document.documentElement.dataset.nativeTransparency = !settingsWindow && status.active ? 'active' : 'inactive'
}
