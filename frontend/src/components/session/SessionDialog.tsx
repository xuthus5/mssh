import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
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
import { SSHJumpHostSection } from '@/components/session/SSHJumpHostSection'


function FormSection({ title, children, disabled, collapsible = false }: { title: string; children: ReactNode; disabled: boolean; collapsible?: boolean }) {
  const [expanded, setExpanded] = useState(!collapsible)
  if (collapsible) {
    return (
      <section className="rounded-xl border border-border bg-card shadow-sm">
        <button type="button" aria-expanded={expanded} className="flex w-full items-center gap-1.5 rounded-xl px-3 py-2 text-left text-xs font-semibold text-foreground outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/70" onClick={() => setExpanded((value) => !value)}>
          {expanded ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
          {title}
        </button>
        {expanded ? <fieldset disabled={disabled} className="border-0 px-3 pb-3 pt-1 disabled:opacity-70"><div className="flex flex-col gap-3">{children}</div></fieldset> : null}
      </section>
    )
  }
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
          <FormSection title={t('SSH 连接隧道')} disabled={controller.pending}><SSHJumpHostSection controller={controller} /></FormSection>
          <FormSection title={t('资产归属')} disabled={controller.pending}><SessionAssetSection props={props} controller={controller} /></FormSection>
          <FormSection title={t('终端选项')} disabled={controller.pending} collapsible><SessionTerminalSection controller={controller} /></FormSection>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={controller.pending} onClick={() => controller.handleOpenChange(false)}>{t('取消')}</Button>
            <Button type="submit" disabled={controller.pending || controller.jumpHost.testing}>{controller.pending ? t('保存中...') : controller.isEditing ? t('保存') : t('创建会话')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
