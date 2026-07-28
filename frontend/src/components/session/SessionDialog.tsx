import type { ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n'
import { SessionAssetSection, SessionConnectionSection, SessionTerminalSection } from '@/components/session/SessionDialogSections'
import { useSessionDialogController, type SessionDialogProps } from '@/components/session/useSessionDialogController'


function FormSection({ title, children, disabled }: { title: string; children: ReactNode; disabled: boolean }) {
  return (
    <fieldset disabled={disabled} className="rounded-xl border border-border bg-card px-3 pb-3 pt-2 shadow-sm disabled:opacity-70">
      <legend className="px-1 text-xs font-semibold text-foreground">{title}</legend>
      <div className="flex flex-col gap-3">{children}</div>
    </fieldset>
  )
}

export default function SessionDialog(props: SessionDialogProps) {
  const controller = useSessionDialogController(props)
  return (
    <Dialog open={props.open} onOpenChange={controller.handleOpenChange}>
      <DialogContent showCloseButton={!controller.pending} className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{controller.isEditing ? t('编辑会话') : t('新建会话')}</DialogTitle></DialogHeader>
        <form onSubmit={(event) => { event.preventDefault(); void controller.handleSubmit() }} className="flex flex-col gap-3">
          {controller.submitError && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{controller.submitError}</div>}
          <FormSection title={t('连接与认证')} disabled={controller.pending}><SessionConnectionSection props={props} controller={controller} /></FormSection>
          <FormSection title={t('资产归属')} disabled={controller.pending}><SessionAssetSection props={props} controller={controller} /></FormSection>
          <FormSection title={t('终端选项')} disabled={controller.pending}><SessionTerminalSection controller={controller} /></FormSection>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={controller.pending} onClick={() => controller.handleOpenChange(false)}>{t('取消')}</Button>
            <Button type="submit" disabled={controller.pending}>{controller.pending ? t('保存中...') : controller.isEditing ? t('保存') : t('创建会话')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
