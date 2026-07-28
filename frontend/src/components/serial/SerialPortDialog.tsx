import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { SerialPort, SerialPortInput } from '@/hooks/useSerial'
import { t } from '@/i18n'
import { SerialPortDialogFields } from './SerialPortDialogFields'
import { useSerialPortDialogState } from './useSerialPortDialogState'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  port?: SerialPort | null
  devices: string[]
  onSave: (input: SerialPortInput) => Promise<void>
}

export function SerialPortDialog({ open, onOpenChange, port, devices, onSave }: Props) {
  const state = useSerialPortDialogState({ open, port, devices, onSave, onOpenChange })
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => nextOpen ? onOpenChange(true) : state.close()}>
      <DialogContent className="max-w-lg" showCloseButton={!state.pending}>
        <DialogHeader>
          <DialogTitle>{port ? t('编辑串口配置') : t('新建串口配置')}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void state.submit() }}>
          <SerialPortDialogFields draft={state.draft} devices={devices} disabled={state.pending} onChange={state.updateDraft} />
          {state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={state.close} disabled={state.pending}>{t('取消')}</Button>
            <Button type="submit" disabled={state.pending}>
              {port ? t('保存修改') : t('添加配置')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
