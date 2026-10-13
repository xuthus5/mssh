import { useEffect } from 'react'
import { useAppStore } from '@/store/appStore'
import { useHostKeyPromptDialog } from '@/store/hostKeyPromptDialog'

/**
 * 让指纹确认弹框跟随当前页签：仅在前台页签展示，后台页签的确认保留为待处理提醒。
 */
export function HostKeyPromptSync() {
  const activeSurface = useAppStore((state) => state.activeSurface)
  const tabs = useAppStore((state) => state.tabs)

  useEffect(() => {
    const tabId = activeSurface && activeSurface.type !== 'workspace' ? activeSurface.id : null
    useHostKeyPromptDialog.getState().setActiveTabId(tabId)
  }, [activeSurface])

  useEffect(() => {
    useHostKeyPromptDialog.getState().pruneTabs(tabs.map((tab) => tab.id))
  }, [tabs])

  return null
}
