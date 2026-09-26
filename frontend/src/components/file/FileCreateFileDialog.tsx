import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { createCreateFileSubmit } from '@/components/file/filePanelCreateFileRuntime'
import { t } from '@/i18n'

interface Props {
  panelOpen: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  currentPath: string
  externalBusy: boolean
  onCreate: (name: string) => void | Promise<void>
}

/** Creates an empty remote file in the open directory; the lease mirrors the rename dialog. */
export function FileCreateFileDialog({ panelOpen, open, onOpenChange, currentPath, externalBusy, onCreate }: Props) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lifecycle = useRef(0)
  const generation = useRef(0)
  const requestID = useRef(0)
  const active = useRef(false)

  useEffect(() => {
    const token = ++lifecycle.current
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [])
  useEffect(() => {
    generation.current += 1
    setBusy(active.current)
    setError('')
    setName('')
  }, [open, panelOpen, currentPath])

  const submit = createCreateFileSubmit({
    runtime: { lifecycle, generation, requestID, active },
    panelOpen, name, currentPath, externalBusy, setBusy, setError, onOpenChange,
  })

  return <Dialog open={panelOpen && open} onOpenChange={(next) => { if (!busy) onOpenChange(next) }}>
    <DialogContent showCloseButton={!busy}>
      <DialogHeader><DialogTitle>{t('新建文件')}</DialogTitle></DialogHeader>
      <Input disabled={busy || externalBusy} aria-label={t('文件名')} placeholder={t('文件名')} value={name}
        onChange={(event) => setName(event.target.value)} autoFocus />
      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>{t('取消')}</Button>
        <Button disabled={busy || externalBusy || !name.trim()} onClick={() => { void submit(onCreate) }}>{t('创建')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
