import { X } from 'lucide-react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n'

interface Props {
  error?: string
  actionError?: string
  mutationError?: string
  onRetry: () => void
  onDismiss: () => void
}

/** Directory-load failure and the panel-owned action/mutation errors share this block. */
export function FilePanelAlerts({ error, actionError, mutationError, onRetry, onDismiss }: Props) {
  return <>
    {error ? (
      <Alert variant="destructive" className="m-2">
        <AlertTitle>{t('目录加载失败')}</AlertTitle>
        <AlertDescription>{error}<Button size="xs" variant="outline" className="ml-2" onClick={onRetry}>{t('重试')}</Button></AlertDescription>
      </Alert>
    ) : null}
    {(actionError || mutationError) ? (
      <Alert variant="destructive" className="m-2">
        <AlertDescription>{actionError || mutationError}</AlertDescription>
        <AlertAction>
          <button type="button" aria-label={t('关闭提示')} className="rounded-md p-1 hover:bg-muted" onClick={onDismiss}>
            <X className="size-4" />
          </button>
        </AlertAction>
      </Alert>
    ) : null}
  </>
}
