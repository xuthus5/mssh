import { useState } from 'react'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'
import { getClipboard } from '@/lib/clipboard'
import { requestConfirm } from '@/lib/confirmDialog'
import { logger } from '@/lib/logger'
import { TerminalService } from '@/lib/wails'
import { ContainerActionRequest, type ContainerInfo } from '../../../../bindings/github.com/xuthus5/mssh/internal/model/models'

export type ContainerAction = 'start' | 'stop' | 'restart' | 'remove'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function useContainerActions(terminalID: string, refresh: () => void) {
  const [busy, setBusy] = useState('')
  const runAction = async (container: ContainerInfo, action: ContainerAction) => {
    if (action === 'remove') {
      const confirmed = await requestConfirm({
        title: t('删除容器？'),
        description: t('容器 ${} 将被永久删除，此操作不可恢复。', container.name || container.id),
        confirmLabel: t('删除'),
        destructive: true,
      })
      if (!confirmed) return
    }
    const key = `${action}:${container.engine}:${container.namespace}:${container.id}`
    setBusy(key)
    try {
      await TerminalService.ContainerAction(terminalID, new ContainerActionRequest({
        engine: container.engine, namespace: container.namespace, id: container.id, action,
      }))
      toast(t('容器操作已完成'), 'success')
      refresh()
    } catch (error: unknown) {
      logger.error('container action failed', error)
      toast(t('容器操作失败: ${}', errorMessage(error)), 'error')
    } finally {
      setBusy('')
    }
  }
  const copyRunCommand = async (container: ContainerInfo) => {
    setBusy(`copy:${container.engine}:${container.namespace}:${container.id}`)
    try {
      const command = await TerminalService.ContainerRunCommand(terminalID, container.engine, container.namespace, container.id)
      if (!command.trim()) throw new Error(t('运行命令为空'))
      await getClipboard().writeText(command)
      toast(t('运行命令已复制'), 'success')
    } catch (error: unknown) {
      logger.error('copy container run command failed', error)
      toast(t('复制运行命令失败: ${}', errorMessage(error)), 'error')
    } finally {
      setBusy('')
    }
  }
  return { busy, runAction, copyRunCommand }
}
