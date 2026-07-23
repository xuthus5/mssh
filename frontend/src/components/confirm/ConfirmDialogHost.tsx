import { useSyncExternalStore } from 'react'
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
import {
  getConfirmDialogSnapshot,
  resolveConfirmDialog,
  subscribeConfirmDialog,
} from '@/lib/confirmDialog'
import { t } from '@/i18n'

export function ConfirmDialogHost() {
  const request = useSyncExternalStore(subscribeConfirmDialog, getConfirmDialogSnapshot, () => null)
  const open = request !== null
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resolveConfirmDialog(false)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{request?.title ?? t('确认')}</AlertDialogTitle>
          {request?.description ? (
            <AlertDialogDescription>{request.description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel type="button" onClick={() => resolveConfirmDialog(false)}>
            {request?.cancelLabel ?? t('取消')}
          </AlertDialogCancel>
          <AlertDialogAction
            type="button"
            variant={request?.destructive ? 'destructive' : 'default'}
            onClick={() => resolveConfirmDialog(true)}
          >
            {request?.confirmLabel ?? t('确认')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
