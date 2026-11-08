import { useEffect, useRef } from 'react'
import { Events } from '@wailsio/runtime'
import { AboutService } from '@/lib/wails'
import { requestConfirm } from '@/lib/confirmDialog'
import { toast } from '@/components/ui/toast'
import { logger } from '@/lib/logger'
import { t } from '@/i18n'

export const UPDATE_READY_EVENT = 'mssh:update-ready'

interface UpdateReadyPayload {
  latest_version?: string
  update_available?: boolean
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function UpdateReadyHost() {
  const promptedVersion = useRef('')

  useEffect(() => {
    let mounted = true
    const prompt = async (update: UpdateReadyPayload | null | undefined) => {
      if (!mounted || !update?.update_available || !update.latest_version) return
      if (promptedVersion.current === update.latest_version) return
      promptedVersion.current = update.latest_version
      const confirmed = await requestConfirm({
        title: t('更新已下载'),
        description: t('新版本 ${} 已准备好，是否立即重启并安装？', update.latest_version),
        confirmLabel: t('立即更新'),
        cancelLabel: t('稍后'),
      })
      if (!confirmed || !mounted) return
      try {
        await AboutService.RestartUpdate()
      } catch (error) {
        logger.error('restart update failed', error)
        toast(t('重启更新失败：${}', errorMessage(error)), 'error')
      }
    }
    const stop = Events.On(UPDATE_READY_EVENT, (event: { data?: UpdateReadyPayload }) => {
      void prompt(event.data)
    })
    void AboutService.ReadyUpdate().then(prompt).catch((error: unknown) => {
      logger.error('load ready update failed', error)
    })
    return () => {
      mounted = false
      if (typeof stop === 'function') stop()
    }
  }, [])

  return null
}
