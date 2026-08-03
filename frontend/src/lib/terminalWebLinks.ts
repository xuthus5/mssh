import { Browser } from '@wailsio/runtime'
import { toast } from '@/components/ui/toast'
import { logger } from '@/lib/logger'
import { normalizeExternalHTTPURL } from '@/lib/externalURL'
import { t } from '@/i18n'

/** Open an http(s) terminal link in the system browser when clicked. */
export function openTerminalWebLink(_event: MouseEvent, uri: string) {
  const normalized = normalizeExternalHTTPURL(uri)
  if (!normalized) return
  void Browser.OpenURL(normalized).catch((error: unknown) => {
    logger.error('terminal web link open failed', error)
    toast(t('打开链接失败: ${}', error instanceof Error ? error.message : String(error)), 'error')
  })
}
