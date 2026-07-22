import { Copy } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { SerialPort } from '@/hooks/useSerial'
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
  deletingID: number | null
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
    ports, filtered, devices, activeDevices, selected, connectingID, deletingID,
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
          {filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                {ports.length === 0 ? t('暂无串口配置，点击右上角新建') : t('没有匹配的串口配置')}
              </TableCell>
            </TableRow>
          ) : filtered.map((port) => {
            const id = Number(port.id)
            const inUse = Boolean(activeDevices[port.device])
            const present = devices.includes(port.device)
            return (
              <TableRow key={port.id}>
                <TableCell>
                  <Checkbox checked={selected.has(id)} onCheckedChange={(value) => onToggleOne(id, value === true)} aria-label={t('选择 ${}', port.name)} />
                </TableCell>
                <TableCell className="font-medium">{port.name}</TableCell>
                <TableCell className="font-mono text-xs">{port.device}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatSerialMode(port)} · {port.flow_control || 'none'}
                  {port.local_echo ? ` · ${t('回显')}` : ''}
                </TableCell>
                <TableCell className="text-xs">{lineEndingLabel(port.line_ending)}</TableCell>
                <TableCell>
                  {inUse ? <Badge>{t('使用中')}</Badge> : present ? <Badge variant="secondary">{t('在线')}</Badge> : <Badge variant="outline">{t('未检测到')}</Badge>}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex flex-wrap justify-end gap-1">
                    <Button type="button" size="xs" disabled={connectingID === id || inUse} onClick={() => onConnect(port)}>
                      {connectingID === id ? t('连接中...') : t('连接')}
                    </Button>
                    <Button type="button" size="xs" variant="outline" onClick={() => onEdit(port)}>{t('编辑')}</Button>
                    <Button type="button" size="xs" variant="outline" onClick={() => onDuplicate(port)}><Copy className="size-3" /></Button>
                    <Button type="button" size="xs" variant="ghost" disabled={deletingID === id} onClick={() => onRemove(port)}>{t('删除')}</Button>
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
