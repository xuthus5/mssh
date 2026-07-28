import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Cable } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { TerminalService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'
import { isTerminalGone } from '@/lib/terminalGone'
import { AsyncPoller } from '@/lib/asyncPoller'

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
  const runtime = useSerialSignalRuntime()
  const snapshot = useSerialSignalSnapshot(terminalID, runtime)
  const action = useSerialActionState()
  useSerialSignalPolling({ runtime, snapshot, action })
  const apply = useApplySerialSignals({ terminalID, runtime, snapshot, action })
  const sendBreak = useSendSerialBreak({ terminalID, runtime, snapshot, action })
  return <SerialSignalControls snapshot={snapshot} action={action} apply={apply} sendBreak={sendBreak} />
}

function useSerialSignalRuntime() {
  const pollRef = useRef<AsyncPoller | null>(null)
  const lifecycle = useRef(0)
  const generation = useRef(0)
  const loadRequest = useRef(0)
  const actionRequest = useRef(0)
  const actionActive = useRef(false)
  const stopPolling = useCallback(() => {
    if (pollRef.current === null) return
    pollRef.current.stop()
    pollRef.current = null
  }, [])
  useEffect(() => {
    const token = ++lifecycle.current
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [])
  return useMemo(
    () => ({ pollRef, lifecycle, generation, loadRequest, actionRequest, actionActive, stopPolling }),
    [stopPolling],
  )
}

type SerialSignalRuntime = ReturnType<typeof useSerialSignalRuntime>

function useSerialSignalSnapshot(terminalID: string, runtime: SerialSignalRuntime) {
  const [dtr, setDtr] = useState(true)
  const [rts, setRts] = useState(true)
  const [inputs, setInputs] = useState<ModemInputs>(emptyInputs)
  const [alive, setAlive] = useState(true)
  const load = useCallback(async (generationToken: number) => {
    const lifecycleToken = runtime.lifecycle.current
    const request = ++runtime.loadRequest.current
    const isCurrent = () => runtime.lifecycle.current === lifecycleToken
      && runtime.generation.current === generationToken && runtime.loadRequest.current === request
    try {
      const signals = await TerminalService.SerialSignals(terminalID)
      if (!isCurrent()) return
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
      if (!isCurrent()) return
      if (isTerminalGone(err)) {
        runtime.loadRequest.current++
        setAlive(false)
        runtime.stopPolling()
        return
      }
      logger.error('load serial signals failed', err)
      // Polling path: avoid spam; user actions surface actionError inline.
    }
  }, [runtime, terminalID])
  return { dtr, rts, inputs, alive, setDtr, setRts, setAlive, load }
}

type SerialSignalSnapshot = ReturnType<typeof useSerialSignalSnapshot>

function useSerialActionState() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return { busy, error, setBusy, setError }
}

type SerialActionState = ReturnType<typeof useSerialActionState>

function useSerialSignalPolling({ runtime, snapshot, action }: {
  runtime: SerialSignalRuntime
  snapshot: SerialSignalSnapshot
  action: SerialActionState
}) {
  useEffect(() => {
    const generationToken = ++runtime.generation.current
    snapshot.setAlive(true)
    action.setError('')
    runtime.stopPolling()
    const poller = new AsyncPoller({
      task: () => snapshot.load(generationToken),
      delayMs: 1000,
      onError: (error) => logger.error('serial signal polling failed', error),
    })
    runtime.pollRef.current = poller
    void poller.start()
    return () => {
      runtime.stopPolling()
      runtime.loadRequest.current++
      if (runtime.generation.current === generationToken) runtime.generation.current++
    }
  }, [action.setBusy, action.setError, runtime, snapshot.load, snapshot.setAlive])
}

function useApplySerialSignals({ terminalID, runtime, snapshot, action }: {
  terminalID: string
  runtime: SerialSignalRuntime
  snapshot: SerialSignalSnapshot
  action: SerialActionState
}) {
  return async (nextDtr: boolean, nextRts: boolean) => {
    if (!snapshot.alive || runtime.actionActive.current) return
    runtime.actionActive.current = true
    const lifecycleToken = runtime.lifecycle.current
    const generationToken = runtime.generation.current
    const actionToken = ++runtime.actionRequest.current
    const isCurrent = () => runtime.lifecycle.current === lifecycleToken
      && runtime.generation.current === generationToken && runtime.actionRequest.current === actionToken
    const isLatest = () => runtime.lifecycle.current === lifecycleToken
      && runtime.actionRequest.current === actionToken
    runtime.loadRequest.current++
    action.setBusy(true)
    action.setError('')
    try {
      await TerminalService.SerialSetSignals(terminalID, nextDtr, nextRts)
      if (!isCurrent()) return
      snapshot.setDtr(nextDtr)
      snapshot.setRts(nextRts)
    } catch (err) {
      if (!isCurrent()) return
      if (isTerminalGone(err)) {
        runtime.loadRequest.current++
        snapshot.setAlive(false)
        runtime.stopPolling()
      } else {
        action.setError(t('设置串口信号失败: ${}', err instanceof Error ? err.message : String(err)))
        await (runtime.pollRef.current?.trigger() ?? snapshot.load(generationToken))
      }
    } finally {
      if (isLatest()) { runtime.actionActive.current = false; action.setBusy(false) }
    }
  }
}

function useSendSerialBreak({ terminalID, runtime, snapshot, action }: {
  terminalID: string
  runtime: SerialSignalRuntime
  snapshot: SerialSignalSnapshot
  action: SerialActionState
}) {
  return async () => {
    if (!snapshot.alive || runtime.actionActive.current) return
    runtime.actionActive.current = true
    const lifecycleToken = runtime.lifecycle.current
    const generationToken = runtime.generation.current
    const actionToken = ++runtime.actionRequest.current
    const isCurrent = () => runtime.lifecycle.current === lifecycleToken
      && runtime.generation.current === generationToken && runtime.actionRequest.current === actionToken
    const isLatest = () => runtime.lifecycle.current === lifecycleToken
      && runtime.actionRequest.current === actionToken
    action.setBusy(true)
    action.setError('')
    try {
      await TerminalService.SerialBreak(terminalID, 250)
      if (isCurrent()) toast(t('已发送 Break'), 'success')
    } catch (err) {
      if (!isCurrent()) return
      if (isTerminalGone(err)) {
        runtime.loadRequest.current++
        snapshot.setAlive(false)
        runtime.stopPolling()
      } else {
        action.setError(t('发送 Break 失败: ${}', err instanceof Error ? err.message : String(err)))
      }
    } finally {
      if (isLatest()) { runtime.actionActive.current = false; action.setBusy(false) }
    }
  }
}

function SerialSignalControls({ snapshot, action, apply, sendBreak }: {
  snapshot: SerialSignalSnapshot
  action: SerialActionState
  apply: (nextDtr: boolean, nextRts: boolean) => Promise<void>
  sendBreak: () => Promise<void>
}) {
  return <div className="flex max-w-full flex-wrap items-center gap-2 border-l border-border pl-2 text-xs text-muted-foreground">
      <Cable className="size-3.5" />
      <label className="flex items-center gap-1">
        <span>DTR</span>
        <Switch checked={snapshot.dtr} disabled={action.busy || !snapshot.alive} onCheckedChange={(value) => void apply(value, snapshot.rts)} />
      </label>
      <label className="flex items-center gap-1">
        <span>RTS</span>
        <Switch checked={snapshot.rts} disabled={action.busy || !snapshot.alive} onCheckedChange={(value) => void apply(snapshot.dtr, value)} />
      </label>
      <div className="flex items-center gap-1" aria-label={t('调制解调器状态')}>
        <StatusLamp label="CTS" on={snapshot.inputs.cts} />
        <StatusLamp label="DSR" on={snapshot.inputs.dsr} />
        <StatusLamp label="DCD" on={snapshot.inputs.dcd} />
        <StatusLamp label="RI" on={snapshot.inputs.ri} />
      </div>
      <Button type="button" size="xs" variant="outline" disabled={action.busy || !snapshot.alive} onClick={() => void sendBreak()}>
        Break
      </Button>
      {action.error ? <p role="alert" className="basis-full text-[11px] text-destructive">{action.error}</p> : null}
    </div>
}
