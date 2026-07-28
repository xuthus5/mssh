import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

  it('supports bulk delete selection through AlertDialog', async () => {
    const user = userEvent.setup()
    render(<SerialPortCenter />)
    await waitFor(() => expect(screen.getByText('ESP32')).toBeInTheDocument())
    const checkbox = screen.getByRole('checkbox', { name: '选择 ESP32' })
    await user.click(checkbox)
    await user.click(screen.getByRole('button', { name: /批量删除/ }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText(/确认删除选中的 1 个串口配置/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => {
      expect(useToastStore.getState().toasts.some((item) => item.message.includes('已删除'))).toBe(true)
    })
  })

  it('deletes a single serial profile through AlertDialog', async () => {
    const user = userEvent.setup()
    __registerHandler(serial + 'Delete', async () => undefined)
    render(<SerialPortCenter />)
    await waitFor(() => expect(screen.getByText('ESP32')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /删除/ }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText(/确认删除串口配置「ESP32」/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => {
      expect(useToastStore.getState().toasts.some((item) => item.message.includes('串口配置已删除'))).toBe(true)
    })
  })

  it('surfaces duplicate and delete failures panel-owned without toast', async () => {
    const user = userEvent.setup()
    useToastStore.setState({ toasts: [] })
    __registerHandler(serial + 'Create', async () => { throw new Error('dup failed') })
    render(<SerialPortCenter />)
    await waitFor(() => expect(screen.getByText('ESP32')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /复制/ }))
    await waitFor(() => expect(screen.getByText('复制串口配置失败: dup failed')).toBeInTheDocument())
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)

    useToastStore.setState({ toasts: [] })
    const deleteCalls: number[] = []
    __registerHandler(serial + 'Delete', async (id: number) => {
      deleteCalls.push(id)
      throw new Error('del failed')
    })
    await user.click(screen.getByRole('button', { name: /删除/ }))
    await user.click(await screen.findByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(deleteCalls).toEqual([1]))
    await waitFor(() => expect(screen.getByText('删除串口配置失败: del failed')).toBeInTheDocument())
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
  })

  it('prevents duplicate serial connect submissions', async () => {
    let resolveOpen: ((terminalID: string) => void) | undefined
    const openSerial = vi.fn(() => new Promise<string>((resolve) => { resolveOpen = resolve }))
    __registerHandler(terminal + 'OpenSerial', openSerial)
    render(<SerialPortCenter />)
    const connect = await screen.findByRole('button', { name: '连接' })
    await userEvent.click(connect)
    expect(screen.getByRole('button', { name: '连接中...' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '连接中...' }))
    expect(openSerial).toHaveBeenCalledOnce()
    await act(async () => { resolveOpen?.('term-serial-1') })
  })

  it('prevents duplicate serial profile copies', async () => {
    let resolveCreate: ((port: typeof samplePort) => void) | undefined
    const create = vi.fn(() => new Promise<typeof samplePort>((resolve) => { resolveCreate = resolve }))
    __registerHandler(serial + 'Create', create)
    render(<SerialPortCenter />)
    const copy = await screen.findByRole('button', { name: '复制' })
    await userEvent.click(copy)
    expect(copy).toBeDisabled()
    await userEvent.click(copy)
    expect(create).toHaveBeenCalledOnce()
    await act(async () => { resolveCreate?.({ ...samplePort, id: 2 }) })
  })

  it('shares a row lease across connect copy and delete actions', async () => {
    let resolveOpen: ((terminalID: string) => void) | undefined
    const openSerial = vi.fn(() => new Promise<string>((resolve) => { resolveOpen = resolve }))
    const create = vi.fn(async (input: typeof samplePort) => ({ ...samplePort, ...input, id: 2 }))
    __registerHandler(terminal + 'OpenSerial', openSerial)
    __registerHandler(serial + 'Create', create)
    render(<SerialPortCenter />)

    const connect = await screen.findByRole('button', { name: '连接' })
    const copy = screen.getByRole('button', { name: '复制' })
    const edit = screen.getByRole('button', { name: '编辑' })
    const remove = screen.getByRole('button', { name: '删除' })
    act(() => {
      fireEvent.click(connect)
      fireEvent.click(copy)
      fireEvent.click(edit)
      fireEvent.click(remove)
    })

    await waitFor(() => expect(openSerial).toHaveBeenCalledOnce())
    expect(create).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '编辑串口配置' })).not.toBeInTheDocument()
    expect(copy).toBeDisabled()
    expect(edit).toBeDisabled()
    expect(remove).toBeDisabled()
    await act(async () => { resolveOpen?.('term-serial-1') })
  })

  it('allows non-conflicting actions on different serial profiles', async () => {
    const secondPort = { ...samplePort, id: 2, name: 'Arduino', device: '/dev/ttyACM0' }
    let resolveOpen: ((terminalID: string) => void) | undefined
    const openSerial = vi.fn(() => new Promise<string>((resolve) => { resolveOpen = resolve }))
    const create = vi.fn(async (input: typeof samplePort) => ({ ...samplePort, ...input, id: 3 }))
    __registerHandler(serial + 'List', async () => ([samplePort, secondPort]))
    __registerHandler(terminal + 'OpenSerial', openSerial)
    __registerHandler(serial + 'Create', create)
    render(<SerialPortCenter />)

    const firstRow = (await screen.findByText('ESP32')).closest('tr')!
    const secondRow = screen.getByText('Arduino').closest('tr')!
    act(() => {
      fireEvent.click(within(firstRow).getByRole('button', { name: '连接' }))
      fireEvent.click(within(secondRow).getByRole('button', { name: '复制' }))
    })

    await waitFor(() => expect(openSerial).toHaveBeenCalledOnce())
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    await act(async () => { resolveOpen?.('term-serial-1') })
  })
})
