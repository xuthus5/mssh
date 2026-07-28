import { useAppStore } from '@/store/appStore'
import { t } from '@/i18n'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useWorkspacePersistence } from '@/components/layout/workspacePersistenceRuntime'

export function WorkspacePersistence() {
  useWorkspacePersistence()
  return null
}

export function WorkspaceRestoreBanner() {
  const error = useAppStore((state) => state.workspaceRestoreError)
  const notice = useAppStore((state) => state.workspaceRestoreNotice)
  const saveError = useAppStore((state) => state.workspaceSaveError)
  const shellActionError = useAppStore((state) => state.shellActionError)
  const retry = useAppStore((state) => state.retryWorkspaceRestore)
  const dismissNotice = useAppStore((state) => state.setWorkspaceRestoreNotice)
  const dismissSaveError = useAppStore((state) => state.setWorkspaceSaveError)
  const dismissShellError = useAppStore((state) => state.setShellActionError)
  if (!error && !notice && !saveError && !shellActionError) return null
  if (error) {
    return (
      <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
        <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
          <span>{t('恢复工作区失败: ${}', error)}</span>
          <Button type="button" size="xs" variant="outline" onClick={() => retry()}>{t('重试')}</Button>
        </AlertDescription>
      </Alert>
    )
  }
  if (saveError) {
    return (
      <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
        <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
          <span>{t('保存工作区失败: ${}', saveError)}</span>
          <Button type="button" size="xs" variant="outline" onClick={() => dismissSaveError('')}>{t('关闭')}</Button>
        </AlertDescription>
      </Alert>
    )
  }
  if (shellActionError) {
    return (
      <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
        <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
          <span>{shellActionError}</span>
          <Button type="button" size="xs" variant="outline" onClick={() => dismissShellError('')}>{t('关闭')}</Button>
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <Alert className="rounded-none border-x-0 border-t-0">
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
        <span>{notice}</span>
        <Button type="button" size="xs" variant="outline" onClick={() => dismissNotice('')}>{t('关闭')}</Button>
      </AlertDescription>
    </Alert>
  )
}
