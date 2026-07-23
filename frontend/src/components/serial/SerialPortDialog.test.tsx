import { render, screen, waitFor } from '@testing-library/react'
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
    expect(await screen.findByText('serial save failed')).toBeInTheDocument()
    expect(useToastStore.getState().toasts).toHaveLength(0)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
