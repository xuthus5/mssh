/** 运行平台检测工具。 */

/** 当运行在 Windows 宿主时返回 true。 */
export function isWindowsPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /win/i.test(navigator.platform)
}
