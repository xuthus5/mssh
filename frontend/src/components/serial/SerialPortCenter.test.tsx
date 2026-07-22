import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SerialPortCenter } from '@/components/serial/SerialPortCenter'
import { __clearHandlers, __registerHandler } from '@/test/__mocks__/wails-runtime'
import { useAppStore } from '@/store/appStore'
import { useToastStore } from '@/components/ui/toast'

const serial = 'github.com/xuthus5/mssh/internal/service.SerialService.'
const terminal = 'github.com/xuthus5/mssh/internal/service.TerminalService.'

const samplePort = {
  id: 1, name: 'ESP32', device: '/dev/ttyUSB0', baud_rate: 115200, data_bits: 8,
  parity: 'none', stop_bits: '1', flow_control: 'none', line_ending: 'cr',
  local_echo: false, dtr_on_open: true, rts_on_open: true, notes: 'board', sort_order: 0,
  created_at: '', updated_at: '',
}

describe('SerialPortCenter', () => {
  beforeEach(() => {
    __clearHandlers()
    __registerHandler(serial + 'List', async () => ([samplePort]))
    __registerHandler(serial + 'ListDevices', async () => ['/dev/ttyUSB0', '/dev/ttyACM0'])
    __registerHandler(serial + 'ActiveDeviceMap', async () => ({}))
    __registerHandler(serial + 'DeleteMany', async () => 1)
    __registerHandler(serial + 'Create', async (input: typeof samplePort) => ({ ...samplePort, ...input, id: 2, name: input.name }))
    __registerHandler(terminal + 'OpenSerial', async () => 'term-serial-1')
    __registerHandler(terminal + 'Count', async () => 0)
  })

  it('lists serial profiles in overview and connects', async () => {
    useAppStore.setState({ tabs: [], connectionStatus: {} })
    useToastStore.setState({ toasts: [] })
    const user = userEvent.setup()
    render(<SerialPortCenter />)
    await waitFor(() => expect(screen.getByRole('heading', { name: '串口管理' })).toBeInTheDocument())
    expect(screen.getByText('ESP32')).toBeInTheDocument()
    expect(screen.getAllByText('/dev/ttyUSB0').length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: '连接' }))
    await waitFor(() => {
      const tab = useAppStore.getState().tabs.find((item) => item.type === 'terminal')
      expect(tab).toMatchObject({ terminalId: 'term-serial-1', connectionKind: 'serial', serialPortId: 1 })
    })
    expect(useToastStore.getState().toasts.some((item) => item.message.includes('串口已连接'))).toBe(true)
  })

  it('opens create dialog from header action', async () => {
    const user = userEvent.setup()
    render(<SerialPortCenter />)
    await waitFor(() => expect(screen.getByRole('heading', { name: '串口管理' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: '新建串口配置' }))
    expect(await screen.findByRole('heading', { name: '新建串口配置' })).toBeInTheDocument()
  })

  it('supports bulk delete selection', async () => {
    const user = userEvent.setup()
    window.confirm = vi.fn(() => true)
    render(<SerialPortCenter />)
    await waitFor(() => expect(screen.getByText('ESP32')).toBeInTheDocument())
    const checkbox = screen.getByRole('checkbox', { name: '选择 ESP32' })
    await user.click(checkbox)
    await user.click(screen.getByRole('button', { name: /批量删除/ }))
    await waitFor(() => {
      expect(useToastStore.getState().toasts.some((item) => item.message.includes('已删除'))).toBe(true)
    })
  })
})
