import { useId, useMemo } from 'react'
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type { SerialPortInput } from '@/hooks/useSerial'
import { t } from '@/i18n'
import {
  SerialLineEnding,
  SerialParity,
  SerialStopBits,
} from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

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

interface DraftFieldsProps {
  draft: SerialPortInput
  onChange: (patch: Partial<SerialPortInput>) => void
}

interface DialogFieldsProps extends DraftFieldsProps {
  devices: string[]
  disabled?: boolean
}

interface IdentityFieldsProps extends DialogFieldsProps {
  deviceId: string
  nameId: string
}

function SerialIdentityFields({ draft, devices, deviceId, nameId, onChange }: IdentityFieldsProps) {
  const deviceOptions = useMemo(() => {
    const values = new Set(devices)
    if (draft.device) values.add(draft.device)
    return Array.from(values).filter(Boolean).map((device) => ({ value: device, label: device }))
  }, [devices, draft.device])

  return <>
    <Field>
      <FieldLabel htmlFor={nameId}>{t('名称')}</FieldLabel>
      <Input id={nameId} value={draft.name} onChange={(event) => onChange({ name: event.target.value })} placeholder={t('例如开发板')} />
    </Field>
    <Field>
      <FieldContent>
        <FieldLabel htmlFor={deviceId}>{t('设备')}</FieldLabel>
        <FieldDescription>{t('选择已检测到的串口，或手动填写设备路径（如 /dev/ttyUSB0、COM3）。')}</FieldDescription>
      </FieldContent>
      {deviceOptions.length > 0 ? <LabeledSelect
        ariaLabel={t('设备')}
        value={draft.device}
        options={deviceOptions}
        onValueChange={(device) => onChange({ device })}
      /> : null}
      <Input id={deviceId} className="mt-2" value={draft.device} onChange={(event) => onChange({ device: event.target.value })} placeholder="/dev/ttyUSB0" />
    </Field>
  </>
}

function SerialSpeedFields({ draft, onChange }: DraftFieldsProps) {
  const selectedBaud = BAUD_OPTIONS.includes(Number(draft.baud_rate))
    ? String(draft.baud_rate)
    : 'custom'
  const selectBaud = (value: string) => {
    if (value !== 'custom') {
      onChange({ baud_rate: Number(value) })
      return
    }
    const current = Number(draft.baud_rate)
    onChange({ baud_rate: current > 0 && !BAUD_OPTIONS.includes(current) ? current : 14400 })
  }
  return <>
    <Field>
      <FieldContent>
        <FieldLabel>{t('波特率')}</FieldLabel>
        <FieldDescription>{t('常用值可点选，也支持直接输入自定义数值。')}</FieldDescription>
      </FieldContent>
      <div className="flex flex-col gap-2">
        <LabeledSelect ariaLabel={t('波特率预设')} value={selectedBaud} options={[
          ...BAUD_OPTIONS.map((value) => ({ value: String(value), label: String(value) })),
          { value: 'custom', label: t('自定义') },
        ]} onValueChange={selectBaud} />
        <Input type="number" min={300} max={4000000} step={1} aria-label={t('波特率')}
          value={String(draft.baud_rate || '')} onChange={(event) => {
            const baudRate = Number(event.target.value)
            if (Number.isFinite(baudRate)) onChange({ baud_rate: Math.trunc(baudRate) })
          }} />
      </div>
    </Field>
    <Field>
      <FieldLabel>{t('数据位')}</FieldLabel>
      <LabeledSelect ariaLabel={t('数据位')} value={String(draft.data_bits)}
        options={DATA_BITS.map((value) => ({ value: String(value), label: String(value) }))}
        onValueChange={(value) => onChange({ data_bits: Number(value) })} />
    </Field>
  </>
}

function SerialFrameFields({ draft, onChange }: DraftFieldsProps) {
  return <>
    <Field>
      <FieldLabel>{t('校验位')}</FieldLabel>
      <LabeledSelect ariaLabel={t('校验位')} value={String(draft.parity)} options={PARITY_OPTIONS}
        onValueChange={(parity) => onChange({ parity: parity as SerialPortInput['parity'] })} />
    </Field>
    <Field>
      <FieldLabel>{t('停止位')}</FieldLabel>
      <LabeledSelect ariaLabel={t('停止位')} value={String(draft.stop_bits)} options={STOP_OPTIONS}
        onValueChange={(stopBits) => onChange({ stop_bits: stopBits as SerialPortInput['stop_bits'] })} />
    </Field>
  </>
}

function SerialFlowFields({ draft, onChange }: DraftFieldsProps) {
  return <>
    <Field>
      <FieldContent>
        <FieldLabel>{t('流控')}</FieldLabel>
        <FieldDescription>{t('连接时应用到底层串口。DSR/DTR 在 Windows 启用硬件握手；Linux/macOS 仅保持 DTR/RTS 电平，不提供完整 DSR 握手。')}</FieldDescription>
      </FieldContent>
      <LabeledSelect ariaLabel={t('流控')} value={String(draft.flow_control || 'none')}
        options={FLOW_OPTIONS} onValueChange={(flowControl) => onChange({ flow_control: flowControl })} />
    </Field>
    <Field>
      <FieldLabel>{t('换行符')}</FieldLabel>
      <LabeledSelect ariaLabel={t('换行符')}
        value={String(draft.line_ending || SerialLineEnding.SerialLineEndingCR)} options={LINE_OPTIONS}
        onValueChange={(lineEnding) => onChange({ line_ending: lineEnding as SerialPortInput['line_ending'] })} />
    </Field>
  </>
}

function SerialBehaviorFields({ draft, idPrefix, onChange }: DraftFieldsProps & { idPrefix: string }) {
  const toggles = [
    { key: 'local_echo', label: t('本地回显'), description: t('设备不回显时，在终端中本地显示已发送内容') },
    { key: 'dtr_on_open', label: 'DTR', description: t('打开串口时拉高 DTR') },
    { key: 'rts_on_open', label: 'RTS', description: t('打开串口时拉高 RTS') },
  ] as const
  return <FieldSet className="grid grid-cols-1 gap-3 rounded-xl border border-border p-3">
    <FieldLegend className="sr-only">{t('行为')}</FieldLegend>
    {toggles.map(({ key, label, description }) => {
      const id = `${idPrefix}-${key}`
      return <Field key={key} orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <FieldDescription>{description}</FieldDescription>
        </FieldContent>
        <Switch id={id} checked={Boolean(draft[key])} onCheckedChange={(checked) => onChange({ [key]: checked })} />
      </Field>
    })}
  </FieldSet>
}

export function SerialPortDialogFields({ draft, devices, disabled, onChange }: DialogFieldsProps) {
  const nameId = useId()
  const deviceId = useId()
  const notesId = useId()
  const behaviorId = useId()
  return <FieldSet disabled={disabled} className="max-h-[70vh] gap-3 overflow-y-auto pr-1">
    <SerialIdentityFields draft={draft} devices={devices} deviceId={deviceId} nameId={nameId} onChange={onChange} />
    <div className="grid grid-cols-2 gap-3">
      <SerialSpeedFields draft={draft} onChange={onChange} />
      <SerialFrameFields draft={draft} onChange={onChange} />
      <SerialFlowFields draft={draft} onChange={onChange} />
    </div>
    <SerialBehaviorFields draft={draft} idPrefix={behaviorId} onChange={onChange} />
    <Field>
      <FieldLabel htmlFor={notesId}>{t('备注')}</FieldLabel>
      <Textarea id={notesId} value={draft.notes ?? ''} onChange={(event) => onChange({ notes: event.target.value })} rows={2} />
    </Field>
  </FieldSet>
}
