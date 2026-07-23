import { useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import type { SerialPort, SerialPortInput } from '@/hooks/useSerial'
import { SerialLineEnding, SerialParity, SerialStopBits } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { t } from '@/i18n'

const BAUD_OPTIONS = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600]
const DATA_BITS = [5, 6, 7, 8]
const PARITY_OPTIONS = [
  { value: SerialParity.SerialParityNone, label: 'None' },
  { value: SerialParity.SerialParityOdd, label: 'Odd' },
  { value: SerialParity.SerialParityEven, label: 'Even' },
  { value: SerialParity.SerialParityMark, label: 'Mark' },
  { value: SerialParity.SerialParitySpace, label: 'Space' },
]
const STOP_OPTIONS = [
  { value: SerialStopBits.SerialStopBitsOne, label: '1' },
  { value: SerialStopBits.SerialStopBitsOnePointFive, label: '1.5' },
  { value: SerialStopBits.SerialStopBitsTwo, label: '2' },
]
const FLOW_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'xonxoff', label: 'XON/XOFF' },
  { value: 'rtscts', label: 'RTS/CTS' },
  { value: 'dsrdtr', label: 'DSR/DTR' },
]
const LINE_OPTIONS = [
  { value: SerialLineEnding.SerialLineEndingCR, label: 'CR (\\r)' },
  { value: SerialLineEnding.SerialLineEndingLF, label: 'LF (\\n)' },
  { value: SerialLineEnding.SerialLineEndingCRLF, label: 'CRLF (\\r\\n)' },
]

function emptyDraft(device = ''): SerialPortInput {
  return {
    id: 0,
    name: '',
    device: device,
    baud_rate: 115200,
    data_bits: 8,
    parity: SerialParity.SerialParityNone,
    stop_bits: SerialStopBits.SerialStopBitsOne,
    flow_control: 'none',
    line_ending: SerialLineEnding.SerialLineEndingCR,
    local_echo: false,
    dtr_on_open: true,
    rts_on_open: true,
    notes: '',
    sort_order: 0,
  }
}

function fromPort(port: SerialPort): SerialPortInput {
  return {
    id: port.id,
    name: port.name,
    device: port.device,
    baud_rate: port.baud_rate,
    data_bits: port.data_bits,
    parity: port.parity,
    stop_bits: port.stop_bits,
    flow_control: port.flow_control,
    line_ending: port.line_ending || SerialLineEnding.SerialLineEndingCR,
    local_echo: Boolean(port.local_echo),
    dtr_on_open: port.dtr_on_open !== false,
    rts_on_open: port.rts_on_open !== false,
    notes: port.notes,
    sort_order: port.sort_order,
  }
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  port?: SerialPort | null
  devices: string[]
  onSave: (input: SerialPortInput) => Promise<void>
}

export function SerialPortDialog({ open, onOpenChange, port, devices, onSave }: Props) {
  const [draft, setDraft] = useState<SerialPortInput>(() => emptyDraft())
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setDraft(port ? fromPort(port) : emptyDraft(devices[0] ?? ''))
    setError('')
  }, [open, port, devices])

  const deviceOptions = useMemo(() => {
    const values = new Set(devices)
    if (draft.device) values.add(draft.device)
    return Array.from(values).filter(Boolean).map((device) => ({ value: device, label: device }))
  }, [devices, draft.device])

  const submit = async () => {
    if (!draft.name.trim() || !draft.device.trim()) {
      setError(t('名称和设备路径不能为空'))
      return
    }
    if (!draft.baud_rate || draft.baud_rate < 300 || draft.baud_rate > 4_000_000) {
      setError(t('波特率需在 300 到 4000000 之间'))
      return
    }
    setPending(true)
    setError('')
    try {
      await onSave({
        ...draft,
        name: draft.name.trim(),
        device: draft.device.trim(),
        notes: String(draft.notes ?? '').trim(),
      })
      onOpenChange(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{port ? t('编辑串口配置') : t('新建串口配置')}</DialogTitle>
        </DialogHeader>
        <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto pr-1">
          <Field>
            <FieldLabel>{t('名称')}</FieldLabel>
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t('例如开发板')} />
          </Field>
          <Field>
            <FieldContent>
              <FieldLabel>{t('设备')}</FieldLabel>
              <FieldDescription>{t('选择已检测到的串口，或手动填写设备路径（如 /dev/ttyUSB0、COM3）。')}</FieldDescription>
            </FieldContent>
            {deviceOptions.length > 0 ? (
              <LabeledSelect
                ariaLabel={t('设备')}
                value={draft.device}
                options={deviceOptions}
                onValueChange={(value) => setDraft({ ...draft, device: value })}
              />
            ) : null}
            <Input
              className="mt-2"
              value={draft.device}
              onChange={(e) => setDraft({ ...draft, device: e.target.value })}
              placeholder="/dev/ttyUSB0"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldContent>
                <FieldLabel>{t('波特率')}</FieldLabel>
                <FieldDescription>{t('常用值可点选，也支持直接输入自定义数值。')}</FieldDescription>
              </FieldContent>
              <div className="flex flex-col gap-2">
                <LabeledSelect
                  ariaLabel={t('波特率预设')}
                  value={BAUD_OPTIONS.includes(Number(draft.baud_rate)) ? String(draft.baud_rate) : 'custom'}
                  options={[
                    ...BAUD_OPTIONS.map((v) => ({ value: String(v), label: String(v) })),
                    { value: 'custom', label: t('自定义') },
                  ]}
                  onValueChange={(value) => {
                    if (value === 'custom') {
                      setDraft({ ...draft, baud_rate: Number(draft.baud_rate) > 0 && !BAUD_OPTIONS.includes(Number(draft.baud_rate)) ? Number(draft.baud_rate) : 14400 })
                      return
                    }
                    setDraft({ ...draft, baud_rate: Number(value) })
                  }}
                />
                <Input
                  type="number"
                  min={300}
                  max={4000000}
                  step={1}
                  aria-label={t('波特率')}
                  value={String(draft.baud_rate || '')}
                  onChange={(event) => {
                    const next = Number(event.target.value)
                    if (!Number.isFinite(next)) return
                    setDraft({ ...draft, baud_rate: Math.trunc(next) })
                  }}
                />
              </div>
            </Field>
            <Field>
              <FieldLabel>{t('数据位')}</FieldLabel>
              <LabeledSelect
                ariaLabel={t('数据位')}
                value={String(draft.data_bits)}
                options={DATA_BITS.map((v) => ({ value: String(v), label: String(v) }))}
                onValueChange={(value) => setDraft({ ...draft, data_bits: Number(value) })}
              />
            </Field>
            <Field>
              <FieldLabel>{t('校验位')}</FieldLabel>
              <LabeledSelect
                ariaLabel={t('校验位')}
                value={String(draft.parity)}
                options={PARITY_OPTIONS}
                onValueChange={(value) => setDraft({ ...draft, parity: value as SerialPortInput['parity'] })}
              />
            </Field>
            <Field>
              <FieldLabel>{t('停止位')}</FieldLabel>
              <LabeledSelect
                ariaLabel={t('停止位')}
                value={String(draft.stop_bits)}
                options={STOP_OPTIONS}
                onValueChange={(value) => setDraft({ ...draft, stop_bits: value as SerialPortInput['stop_bits'] })}
              />
            </Field>
            <Field>
              <FieldContent>
                <FieldLabel>{t('流控')}</FieldLabel>
                <FieldDescription>{t('连接时应用到底层串口。DSR/DTR 在 Windows 启用硬件握手；Linux/macOS 仅保持 DTR/RTS 电平，不提供完整 DSR 握手。')}</FieldDescription>
              </FieldContent>
              <LabeledSelect
                ariaLabel={t('流控')}
                value={String(draft.flow_control || 'none')}
                options={FLOW_OPTIONS}
                onValueChange={(value) => setDraft({ ...draft, flow_control: value })}
              />
            </Field>
            <Field>
              <FieldLabel>{t('换行符')}</FieldLabel>
              <LabeledSelect
                ariaLabel={t('换行符')}
                value={String(draft.line_ending || SerialLineEnding.SerialLineEndingCR)}
                options={LINE_OPTIONS}
                onValueChange={(value) => setDraft({ ...draft, line_ending: value as SerialPortInput['line_ending'] })}
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">{t('本地回显')}</div>
                <div className="text-xs text-muted-foreground">{t('设备不回显时，在终端中本地显示已发送内容')}</div>
              </div>
              <Switch checked={Boolean(draft.local_echo)} onCheckedChange={(checked) => setDraft({ ...draft, local_echo: checked })} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">DTR</div>
                <div className="text-xs text-muted-foreground">{t('打开串口时拉高 DTR')}</div>
              </div>
              <Switch checked={Boolean(draft.dtr_on_open)} onCheckedChange={(checked) => setDraft({ ...draft, dtr_on_open: checked })} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">RTS</div>
                <div className="text-xs text-muted-foreground">{t('打开串口时拉高 RTS')}</div>
              </div>
              <Switch checked={Boolean(draft.rts_on_open)} onCheckedChange={(checked) => setDraft({ ...draft, rts_on_open: checked })} />
            </div>
          </div>
          <Field>
            <FieldLabel>{t('备注')}</FieldLabel>
            <Textarea value={draft.notes ?? ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} rows={2} />
          </Field>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>{t('取消')}</Button>
          <Button type="button" onClick={() => void submit()} disabled={pending}>
            {port ? t('保存修改') : t('添加配置')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
