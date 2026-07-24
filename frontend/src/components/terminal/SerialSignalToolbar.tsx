import { useCallback, useEffect, useRef, useState } from 'react'
import { Cable } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { TerminalService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'
import { isTerminalGone } from '@/lib/terminalGone'

interface Props {
  terminalID: string
}

type ModemInputs = { cts: boolean; dsr: boolean; dcd: boolean; ri: boolean }

const emptyInputs: ModemInputs = { cts: false, dsr: false, dcd: false, ri: false }

function StatusLamp({ label, on }: { label: string; on: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 font-mono"
      title={label}
      data-testid={`modem-${label.toLowerCase()}`}
    >
      <span className={`size-1.5 rounded-full ${on ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
      {label}
    </span>
  )
}

export function SerialSignalToolbar({ terminalID }: Props) {
  const [dtr, setDtr] = useState(true)
  const [rts, setRts] = useState(true)
  const [inputs, setInputs] = useState<ModemInputs>(emptyInputs)
  const [busy, setBusy] = useState(false)
  const [alive, setAlive] = useState(true)
  const [actionError, setActionError] = useState('')
  const pollRef = useRef<number | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const signals = await TerminalService.SerialSignals(terminalID)
      setDtr(Boolean(signals?.dtr))
      setRts(Boolean(signals?.rts))
      setInputs({
        cts: Boolean(signals?.cts),
        dsr: Boolean(signals?.dsr),
        dcd: Boolean(signals?.dcd),
        ri: Boolean(signals?.ri),
      })
      setAlive(true)
    } catch (err) {
      if (isTerminalGone(err)) {
        setAlive(false)
        stopPolling()
        return
      }
      logger.error('load serial signals failed', err)
      // Polling path: avoid spam; user actions surface actionError inline.
    }
  }, [stopPolling, terminalID])

  useEffect(() => {
    setAlive(true)
    void load()
    stopPolling()
    pollRef.current = window.setInterval(() => { void load() }, 1000)
    return () => stopPolling()
  }, [load, stopPolling])

  const apply = async (nextDtr: boolean, nextRts: boolean) => {
    if (!alive) return
    setBusy(true)
    setActionError('')
    try {
      await TerminalService.SerialSetSignals(terminalID, nextDtr, nextRts)
      setDtr(nextDtr)
      setRts(nextRts)
    } catch (err) {
      if (isTerminalGone(err)) {
        setAlive(false)
        stopPolling()
      } else {
        setActionError(t('设置串口信号失败: ${}', err instanceof Error ? err.message : String(err)))
        await load()
      }
    } finally {
      setBusy(false)
    }
  }

  const sendBreak = async () => {
    if (!alive) return
    setBusy(true)
    setActionError('')
    try {
      await TerminalService.SerialBreak(terminalID, 250)
      toast(t('已发送 Break'), 'success')
    } catch (err) {
      if (isTerminalGone(err)) {
        setAlive(false)
        stopPolling()
      } else {
        setActionError(t('发送 Break 失败: ${}', err instanceof Error ? err.message : String(err)))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex max-w-full flex-wrap items-center gap-2 border-l border-border pl-2 text-xs text-muted-foreground">
      <Cable className="size-3.5" />
      <label className="flex items-center gap-1">
        <span>DTR</span>
        <Switch checked={dtr} disabled={busy || !alive} onCheckedChange={(value) => void apply(value, rts)} />
      </label>
      <label className="flex items-center gap-1">
        <span>RTS</span>
        <Switch checked={rts} disabled={busy || !alive} onCheckedChange={(value) => void apply(dtr, value)} />
      </label>
      <div className="flex items-center gap-1" aria-label={t('调制解调器状态')}>
        <StatusLamp label="CTS" on={inputs.cts} />
        <StatusLamp label="DSR" on={inputs.dsr} />
        <StatusLamp label="DCD" on={inputs.dcd} />
        <StatusLamp label="RI" on={inputs.ri} />
      </div>
      <Button type="button" size="xs" variant="outline" disabled={busy || !alive} onClick={() => void sendBreak()}>
        Break
      </Button>
      {actionError ? <p role="alert" className="basis-full text-[11px] text-destructive">{actionError}</p> : null}
    </div>
  )
}
