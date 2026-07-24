import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import type { ThemeProfile } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { t } from '@/i18n'

type DeleteTarget = ThemeProfile | null

export function ThemeDeleteDialog({
  target,
  pending,
  error = '',
  onOpenChange,
  onConfirm,
}: {
  target: DeleteTarget
  pending: boolean
  error?: string
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const builtin = Boolean(target?.definition?.is_builtin)
  return (
    <AlertDialog open={target !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('删除主题「${}」？', target?.name ?? '')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {builtin
              ? t('将移除该主题配置（Profile）。内置颜色定义会保留，不会被删除。')
              : t('将移除该主题配置（Profile）。若自定义颜色定义不再被引用，也会一并清理。此操作不可撤销。')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t('取消')}</AlertDialogCancel>
          <AlertDialogAction
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? t('删除中…') : t('确认删除')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
