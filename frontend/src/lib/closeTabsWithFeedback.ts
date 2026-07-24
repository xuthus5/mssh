import { toast } from '@/components/ui/toast'
import { logger } from '@/lib/logger'
import { t } from '@/i18n'


type CloseTab = (id: string) => Promise<void>

export type CloseTabErrorHandler = (tabId: string, error: unknown) => void

export function closeTabsWithFeedback(
  tabIDs: string[],
  closeTab: CloseTab,
  onError?: CloseTabErrorHandler,
): void {
  for (const tabId of tabIDs) {
    void closeTab(tabId).catch((error: unknown) => {
      logger.error('close tab failed', { tabId, error })
      if (onError) {
        onError(tabId, error)
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      toast(t('关闭标签失败: ${}', message), 'error')
    })
  }
}
