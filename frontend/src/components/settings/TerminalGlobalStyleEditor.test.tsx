import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { TerminalGlobalStyleEditor } from '@/components/settings/TerminalGlobalStyleEditor'

describe('TerminalGlobalStyleEditor', () => {
  it('edits the global terminal font, size, and cursor style', async () => {
    const onChange = vi.fn()
    render(<TerminalGlobalStyleEditor style={{ font_family: 'Global Font', font_size: 16, cursor_style: 'bar' } as never} onChange={onChange} />)

    await userEvent.clear(screen.getByLabelText('全局终端字体'))
    await userEvent.type(screen.getByLabelText('全局终端字体'), 'JetBrains Mono')
    await userEvent.clear(screen.getByLabelText('全局终端字号'))
    await userEvent.type(screen.getByLabelText('全局终端字号'), '18')
    await userEvent.click(screen.getByRole('combobox', { name: '全局光标样式' }))
    await userEvent.click(await screen.findByRole('option', { name: '下划线' }))

    expect(onChange).toHaveBeenCalledWith('font_family', expect.any(String))
    expect(onChange).toHaveBeenCalledWith('font_size', 18)
    expect(onChange).toHaveBeenCalledWith('cursor_style', 'underline')
  })

  it('disables every field while saving', () => {
    render(<TerminalGlobalStyleEditor style={{ font_family: 'Global Font', font_size: 16, cursor_style: 'bar' } as never} disabled onChange={vi.fn()} />)

    expect(screen.getByLabelText('全局终端字体')).toBeDisabled()
    expect(screen.getByLabelText('全局终端字号')).toBeDisabled()
    expect(screen.getByRole('combobox', { name: '全局光标样式' })).toBeDisabled()
  })

  it('supports controlled updates', async () => {
    render(<GlobalStyleHarness />)

    await userEvent.clear(screen.getByLabelText('全局终端字体'))
    await userEvent.type(screen.getByLabelText('全局终端字体'), 'Cascadia Code')

    expect(screen.getByLabelText('全局终端字体')).toHaveValue('Cascadia Code')
  })

  it('reports invalid font sizes instead of retaining the previous value', async () => {
    render(<GlobalStyleHarness />)

    await userEvent.clear(screen.getByLabelText('全局终端字号'))

    expect(screen.getByLabelText('全局终端字号')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('字号必须是 8 到 48 的整数')
  })
})

function GlobalStyleHarness() {
  const [style, setStyle] = useState({ font_family: 'Global Font', font_size: 16, cursor_style: 'bar' as const })
  return <TerminalGlobalStyleEditor style={style as never} onChange={(key, value) => setStyle((current) => ({ ...current, [key]: value }))} />
}
