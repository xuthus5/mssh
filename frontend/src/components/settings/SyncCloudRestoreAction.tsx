import { useCallback, useEffect, useRef, useState } from 'react'
import { CloudDownload, LoaderCircle } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useSettingsWindowHide } from '@/hooks/useSettingsWindowHide'
import { validateAppPassword } from '@/lib/appPassword'
import type { SyncConfigInput } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { t } from '@/i18n'

interface CloudRestoreProps {
  input: SyncConfigInput
  disabled: boolean
  onJoin: (input: SyncConfigInput, password: string) => Promise<void>
}

function useCloudRestoreDialog(props: CloudRestoreProps) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const active = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const reset = useCallback(() => {
    if (active.current) return
    setOpen(false)
    setPassword('')
    setError('')
  }, [])
  useSettingsWindowHide(reset)
  const changeOpen = (next: boolean) => {
    if (busy) return
    setOpen(next)
    if (!next) reset()
  }
  const submit = async () => {
    if (active.current || props.disabled) return
    if (!password) return setError(t('请输入应用密码'))
    const validationError = validateAppPassword(password, false)
    if (validationError) return setError(t(validationError))
    active.current = true
    setBusy(true)
    setError('')
    try {
      await props.onJoin(props.input, password)
      if (!mounted.current) return
      setOpen(false)
      setPassword('')
    } catch (joinError) {
      if (mounted.current) setError(t('从云端恢复失败: ${}', errorMessage(joinError)))
    } finally {
      active.current = false
      if (mounted.current) setBusy(false)
    }
  }
  return { open, password, setPassword, error, busy, changeOpen, submit, start: () => setOpen(true) }
}

export function SyncCloudRestoreAction(props: CloudRestoreProps) {
  const dialog = useCloudRestoreDialog(props)
  return (
    <>
      <Button type="button" variant="outline" disabled={props.disabled} onClick={dialog.start}>
        <CloudDownload data-icon="inline-start" />
        {t('从云端恢复此设备')}
      </Button>
      <Dialog open={dialog.open} onOpenChange={dialog.changeOpen}>
        <DialogContent showCloseButton={!dialog.busy} className="sm:max-w-md" aria-busy={dialog.busy}>
          <DialogHeader>
            <DialogTitle>{t('从云端恢复此设备？')}</DialogTitle>
            <DialogDescription>{t('此操作会使用云端备份内嵌的 Vault 替换本机 Vault，并覆盖本地会话、密钥、隧道等业务数据。操作前会创建恢复点。请输入备份设备的应用密码。')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="cloud-restore-password">{t('备份设备的应用密码')}</label>
            <Input id="cloud-restore-password" type="password" autoComplete="current-password" disabled={dialog.busy} value={dialog.password} onChange={(event) => dialog.setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void dialog.submit() }} />
          </div>
          {dialog.error ? <Alert variant="destructive"><AlertDescription>{dialog.error}</AlertDescription></Alert> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={dialog.busy} onClick={() => dialog.changeOpen(false)}>{t('取消')}</Button>
            <Button type="button" disabled={dialog.busy} onClick={() => { void dialog.submit() }}>
              {dialog.busy ? <><LoaderCircle className="animate-spin" data-icon="inline-start" />{t('恢复中…')}</> : t('确认恢复')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
