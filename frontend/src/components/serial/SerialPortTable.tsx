import { Copy } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { SerialPort } from '@/hooks/useSerial'
import { isSerialDeviceActive, isSerialDevicePresent } from '@/lib/serialDeviceMatch'
import { t } from '@/i18n'

function formatSerialMode(port: SerialPort): string {
  const parity = String(port.parity || 'none')[0]?.toUpperCase() || 'N'
  return `${port.baud_rate} ${port.data_bits}${parity}${port.stop_bits}`
}

function lineEndingLabel(value: string | undefined): string {
  if (value === 'lf') return 'LF'
  if (value === 'crlf') return 'CRLF'
  return 'CR'
}

interface Props {
  ports: SerialPort[]
  filtered: SerialPort[]
  devices: string[]
  activeDevices: Record<string, string>
  selected: Set<number>
  connectingID: number | null
  duplicatingID: number | null
  deletingID: number | null
  deletePending: boolean
  pendingRows: ReadonlySet<number>
  allFilteredSelected: boolean
  onToggleAll: (checked: boolean) => void
  onToggleOne: (id: number, checked: boolean) => void
  onConnect: (port: SerialPort) => void
  onEdit: (port: SerialPort) => void
  onDuplicate: (port: SerialPort) => void
  onRemove: (port: SerialPort) => void
}

export function SerialPortTable(props: Props) {
  const {
    ports, filtered, devices, activeDevices, selected, connectingID, duplicatingID, deletingID, deletePending,
    allFilteredSelected, onToggleAll, onToggleOne, onConnect, onEdit, onDuplicate, onRemove,
  } = props
  return (
    <div className="rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox checked={allFilteredSelected} onCheckedChange={(value) => onToggleAll(value === true)} aria-label={t('全选')} />
            </TableHead>
            <TableHead>{t('名称')}</TableHead>
            <TableHead>{t('设备')}</TableHead>
            <TableHead>{t('参数')}</TableHead>
            <TableHead>{t('换行符')}</TableHead>
            <TableHead>{t('状态')}</TableHead>
            <TableHead className="text-right">{t('操作')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 ? <SerialPortEmpty hasPorts={ports.length > 0} />
            : filtered.map((port) => <SerialPortRow key={port.id} port={port} props={props} />)}
        </TableBody>
      </Table>
    </div>
  )
}

function SerialPortEmpty({ hasPorts }: { hasPorts: boolean }) {
  return <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
    {hasPorts ? t('没有匹配的串口配置') : t('暂无串口配置，点击右上角新建')}
  </TableCell></TableRow>
}

function SerialPortRow({ port, props }: { port: SerialPort; props: Props }) {
  const id = Number(port.id)
  const inUse = isSerialDeviceActive(port.device, props.activeDevices)
  const present = isSerialDevicePresent(port.device, props.devices)
  const pending = props.pendingRows.has(id)
  return <TableRow>
    <TableCell><Checkbox checked={props.selected.has(id)} disabled={pending} onCheckedChange={(value) => props.onToggleOne(id, value === true)} aria-label={t('选择 ${}', port.name)} /></TableCell>
    <TableCell className="font-medium">{port.name}</TableCell>
    <TableCell className="font-mono text-xs">{port.device}</TableCell>
    <TableCell className="text-xs text-muted-foreground">{formatSerialMode(port)} · {port.flow_control || 'none'}{port.local_echo ? ` · ${t('回显')}` : ''}</TableCell>
    <TableCell className="text-xs">{lineEndingLabel(port.line_ending)}</TableCell>
    <TableCell>{inUse ? <Badge>{t('使用中')}</Badge> : present ? <Badge variant="secondary">{t('在线')}</Badge> : <Badge variant="outline">{t('未检测到')}</Badge>}</TableCell>
    <TableCell className="text-right"><div className="flex flex-wrap justify-end gap-1">
      <Button type="button" size="xs" disabled={props.connectingID !== null || inUse || pending} onClick={() => props.onConnect(port)}>{props.connectingID === id ? t('连接中...') : t('连接')}</Button>
      <Button type="button" size="xs" variant="outline" disabled={pending} onClick={() => props.onEdit(port)}>{t('编辑')}</Button>
      <Button type="button" size="xs" variant="outline" aria-label={t('复制')} disabled={props.duplicatingID !== null || pending} onClick={() => props.onDuplicate(port)}><Copy className="size-3" /></Button>
      <Button type="button" size="xs" variant="ghost" disabled={props.deletePending || props.deletingID === id || inUse || pending} title={inUse ? t('串口使用中，请先关闭终端再删除') : undefined} onClick={() => props.onRemove(port)}>{t('删除')}</Button>
    </div></TableCell>
  </TableRow>
}
