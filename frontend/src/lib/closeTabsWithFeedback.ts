import { toast } from '@/components/ui/toast'
import { logger } from '@/lib/logger'
import { t } from '@/i18n'


type CloseTab = (id: string) => Promise<void>

export function closeTabsWithFeedback(tabIDs: string[], closeTab: CloseTab): void {
  for (const tabId of tabIDs) {
    void closeTab(tabId).catch((error: unknown) => {
      logger.error('close tab failed', { tabId, error })
      const message = error instanceof Error ? error.message : String(error)
      toast(t('关闭标签失败: ${}', message), 'error')
    })
  }
}
