import { useCallback, useEffect, useRef, useState } from 'react'
import type { SerialPort, SerialPortInput } from '@/hooks/useSerial'
import { t } from '@/i18n'
import {
  SerialLineEnding,
  SerialParity,
  SerialStopBits,
} from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

function emptyDraft(device = ''): SerialPortInput {
  return {
    id: 0, name: '', device, baud_rate: 115200, data_bits: 8,
    parity: SerialParity.SerialParityNone,
    stop_bits: SerialStopBits.SerialStopBitsOne,
    flow_control: 'none', line_ending: SerialLineEnding.SerialLineEndingCR,
    local_echo: false, dtr_on_open: true, rts_on_open: true,
    notes: '', sort_order: 0,
  }
}

function fromPort(port: SerialPort): SerialPortInput {
  return {
    id: port.id, name: port.name, device: port.device,
    baud_rate: port.baud_rate, data_bits: port.data_bits,
    parity: port.parity, stop_bits: port.stop_bits,
    flow_control: port.flow_control,
    line_ending: port.line_ending || SerialLineEnding.SerialLineEndingCR,
    local_echo: Boolean(port.local_echo),
    dtr_on_open: port.dtr_on_open !== false,
    rts_on_open: port.rts_on_open !== false,
    notes: port.notes, sort_order: port.sort_order,
  }
}

function validateDraft(draft: SerialPortInput) {
  if (!draft.name.trim() || !draft.device.trim()) return t('名称和设备路径不能为空')
  if (!draft.baud_rate || draft.baud_rate < 300 || draft.baud_rate > 4_000_000) {
    return t('波特率需在 300 到 4000000 之间')
  }
  return ''
}

function normalizeDraft(draft: SerialPortInput): SerialPortInput {
  return {
    ...draft,
    name: draft.name.trim(),
    device: draft.device.trim(),
    notes: String(draft.notes ?? '').trim(),
  }
}

interface SaveLease {
  isCurrent: () => boolean
  isLatest: () => boolean
}

function useSaveLease() {
  const lifecycle = useRef(0)
  const generation = useRef(0)
  const request = useRef(0)
  const active = useRef(false)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => {
      if (lifecycle.current !== token) return
      lifecycle.current++
      active.current = false
    }
  }, [])
  const retarget = useCallback(() => { generation.current++ }, [])
  const begin = useCallback(() => {
    if (active.current) return null
    active.current = true
    const lifecycleToken = lifecycle.current
    const targetToken = generation.current
    const requestToken = ++request.current
    return {
      isCurrent: () => lifecycle.current === lifecycleToken
        && generation.current === targetToken && request.current === requestToken,
      isLatest: () => lifecycle.current === lifecycleToken && request.current === requestToken,
    }
  }, [])
  const finish = useCallback((lease: SaveLease) => {
    if (!lease.isLatest()) return false
    active.current = false
    return true
  }, [])
  const isActive = useCallback(() => active.current, [])
  return { begin, finish, isActive, retarget }
}

interface StateOptions {
  open: boolean
  port?: SerialPort | null
  devices: string[]
  onSave: (input: SerialPortInput) => Promise<void>
  onOpenChange: (open: boolean) => void
}

export function useSerialPortDialogState(options: StateOptions) {
  const { open, port, devices, onSave, onOpenChange } = options
  const [draft, setDraft] = useState<SerialPortInput>(() => emptyDraft())
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const portRef = useRef(port)
  const devicesRef = useRef(devices)
  portRef.current = port
  devicesRef.current = devices
  const lease = useSaveLease()
  const targetID = port?.id ?? 0
  useEffect(() => {
    lease.retarget()
    if (!open) return
    setDraft(portRef.current ? fromPort(portRef.current) : emptyDraft(devicesRef.current[0] ?? ''))
    setError('')
  }, [lease.retarget, open, targetID])
  const updateDraft = useCallback((patch: Partial<SerialPortInput>) => {
    setDraft((current) => ({ ...current, ...patch }))
  }, [])
  const close = useCallback(() => {
    if (lease.isActive()) return
    setError('')
    onOpenChange(false)
  }, [lease.isActive, onOpenChange])
  const submit = useCallback(async () => {
    const validationError = validateDraft(draft)
    if (validationError) { setError(validationError); return }
    const requestLease = lease.begin()
    if (!requestLease) return
    setPending(true)
    setError('')
    try {
      await onSave(normalizeDraft(draft))
      if (requestLease.isCurrent()) onOpenChange(false)
    } catch (reason) {
      if (requestLease.isCurrent()) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (lease.finish(requestLease)) setPending(false)
    }
  }, [draft, lease.begin, lease.finish, onOpenChange, onSave])
  return { draft, pending, error, updateDraft, close, submit }
}
