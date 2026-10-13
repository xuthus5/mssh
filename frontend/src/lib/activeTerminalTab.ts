import { useAppStore } from '@/store/appStore'

/** 目标终端页签是否处于前台（用于区分后台重连与用户当前操作）。 */
export function isActiveTerminalTab(tabId: string): boolean {
  const surface = useAppStore.getState().activeSurface
  return surface?.type === 'terminal' && surface.id === tabId
}
