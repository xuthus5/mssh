import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n'
import { TunnelTable } from '@/components/session/TunnelTable'
import { TunnelDialogForm } from '@/components/session/TunnelDialogForm'
import { useTunnelDialogController, type TunnelDialogProps } from '@/components/session/useTunnelDialogController'

export default function TunnelDialog(props: TunnelDialogProps) {
  const controller = useTunnelDialogController(props)
  return (
    <Dialog open={props.open} onOpenChange={controller.handleOpenChange}>
      <DialogContent showCloseButton={!controller.closeBlocked} className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{t('隧道管理')}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex items-center">
            <Button size="sm" variant="outline" disabled={controller.busy} onClick={() => { if (controller.showAdd) controller.resetForm(); else controller.setShowAdd(true) }}>
              {controller.showAdd ? t('取消') : t('新建隧道')}
            </Button>
          </div>
          {controller.showAdd && <TunnelDialogForm controller={controller} />}
          {controller.actionError ? <p role="alert" className="text-sm text-destructive">{controller.actionError}</p> : null}
          <TunnelTable disabled={controller.busy} tunnels={props.tunnels} loadError={props.loadError ?? ''} onReload={props.onReload} onStart={props.onStart} onStop={props.onStop} onStartAction={(action, failure) => { void controller.runListAction(action, failure) }} onStopAction={(action, failure) => { void controller.runListAction(action, failure) }} onDelete={props.onDelete ? (tunnelID, label) => { void controller.handleDelete(tunnelID, label).catch(() => undefined) } : undefined} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
