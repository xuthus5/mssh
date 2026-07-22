import { useCallback, useEffect, useState } from 'react'
import { Cable } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { TerminalService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'

interface Props {
  terminalID: string
}

export function SerialSignalToolbar({ terminalID }: Props) {
  const [dtr, setDtr] = useState(true)
  const [rts, setRts] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const signals = await TerminalService.SerialSignals(terminalID)
      setDtr(Boolean(signals?.dtr))
      setRts(Boolean(signals?.rts))
    } catch (err) {
      logger.error('load serial signals failed', err)
    }
  }, [terminalID])

  useEffect(() => {
    void load()
  }, [load])

  const apply = async (nextDtr: boolean, nextRts: boolean) => {
    setBusy(true)
    try {
      await TerminalService.SerialSetSignals(terminalID, nextDtr, nextRts)
      setDtr(nextDtr)
      setRts(nextRts)
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
      await load()
    } finally {
      setBusy(false)
    }
  }

  const sendBreak = async () => {
    setBusy(true)
    try {
      await TerminalService.SerialBreak(terminalID, 250)
      toast(t('已发送 Break'), 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2 border-l border-border pl-2 text-xs text-muted-foreground">
      <Cable className="size-3.5" />
      <label className="flex items-center gap-1">
        <span>DTR</span>
        <Switch checked={dtr} disabled={busy} onCheckedChange={(value) => void apply(value, rts)} />
      </label>
      <label className="flex items-center gap-1">
        <span>RTS</span>
        <Switch checked={rts} disabled={busy} onCheckedChange={(value) => void apply(dtr, value)} />
      </label>
      <Button type="button" size="xs" variant="outline" disabled={busy} onClick={() => void sendBreak()}>
        Break
      </Button>
    </div>
  )
}
