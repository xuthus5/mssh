import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SerialPortDialog } from '@/components/serial/SerialPortDialog'
import { useToastStore } from '@/components/ui/toast'

describe('SerialPortDialog', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
  })

  it('shows save failures inline without toast and keeps dialog open', async () => {
    const onSave = vi.fn(async () => {
      throw new Error('serial save failed')
    })
    render(
      <SerialPortDialog
        open
        onOpenChange={vi.fn()}
        port={null}
        devices={['/dev/ttyUSB0']}
        onSave={onSave}
      />,
    )
    const name = screen.getByPlaceholderText('例如开发板')
    await userEvent.clear(name)
    await userEvent.type(name, 'COM-A')
    await userEvent.click(screen.getByRole('button', { name: '添加配置' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('serial save failed')
    expect(useToastStore.getState().toasts).toHaveLength(0)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('keeps the save lease and fields locked across port target changes', async () => {
    const saving = deferred<void>()
    const onOpenChange = vi.fn()
    const onSave = vi.fn()
      .mockImplementationOnce(() => saving.promise)
      .mockResolvedValueOnce(undefined)
    const first = { id: 1, name: '旧串口', device: '/dev/ttyUSB0', baud_rate: 115200, data_bits: 8, parity: 'none' as never, stop_bits: 'one' as never, flow_control: 'none', line_ending: 'CR' as never, local_echo: false, dtr_on_open: true, rts_on_open: true, notes: '', sort_order: 0, created_at: '', updated_at: '' }
    const second = { ...first, id: 2, name: '新串口', device: '/dev/ttyUSB1' }
    const view = render(<SerialPortDialog open onOpenChange={onOpenChange} port={first} devices={['/dev/ttyUSB0', '/dev/ttyUSB1']} onSave={onSave} />)
    const save = screen.getByRole('button', { name: '保存修改' })
    act(() => {
      fireEvent.click(save)
      fireEvent.click(save)
    })
    expect(onSave).toHaveBeenCalledOnce()
    expect(screen.getByPlaceholderText('例如开发板')).toBeDisabled()
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(onOpenChange).not.toHaveBeenCalledWith(false)

    view.rerender(<SerialPortDialog open onOpenChange={onOpenChange} port={second} devices={['/dev/ttyUSB0', '/dev/ttyUSB1']} onSave={onSave} />)
    expect(screen.getByPlaceholderText('例如开发板')).toHaveValue('新串口')
    expect(screen.getByPlaceholderText('例如开发板')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
    expect(onSave).toHaveBeenCalledOnce()

    await act(async () => { saving.resolve(); await Promise.resolve() })
    await waitFor(() => expect(screen.getByRole('button', { name: '保存修改' })).toBeEnabled())
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    await userEvent.click(screen.getByRole('button', { name: '保存修改' }))
    expect(onSave).toHaveBeenCalledTimes(2)
  })

  it('preserves unsaved input when detected devices refresh', async () => {
    const props = {
      open: true,
      onOpenChange: vi.fn(),
      port: null,
      onSave: vi.fn(async () => undefined),
    }
    const view = render(<SerialPortDialog {...props} devices={['/dev/ttyUSB0']} />)
    const name = screen.getByPlaceholderText('例如开发板')
    await userEvent.type(name, '开发板 A')

    view.rerender(<SerialPortDialog {...props} devices={['/dev/ttyUSB0', '/dev/ttyACM0']} />)

    expect(screen.getByPlaceholderText('例如开发板')).toHaveValue('开发板 A')
    expect(screen.getByPlaceholderText('/dev/ttyUSB0')).toHaveValue('/dev/ttyUSB0')
  })

  it('labels editable fields and submits once with Enter', async () => {
    const saving = deferred<void>()
    const onSave = vi.fn(() => saving.promise)
    render(<SerialPortDialog open onOpenChange={vi.fn()} port={null} devices={['/dev/ttyUSB0']} onSave={onSave} />)

    const name = screen.getByRole('textbox', { name: '名称' })
    expect(screen.getByRole('textbox', { name: '设备' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '备注' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: '本地回显' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'DTR' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'RTS' })).toBeInTheDocument()

    await userEvent.type(name, '开发板 A{Enter}{Enter}')
    expect(onSave).toHaveBeenCalledOnce()
    await act(async () => { saving.resolve(); await Promise.resolve() })
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
