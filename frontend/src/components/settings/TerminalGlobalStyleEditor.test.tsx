import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { TerminalGlobalStyleEditor } from '@/components/settings/TerminalGlobalStyleEditor'

describe('TerminalGlobalStyleEditor', () => {
  it('edits the global terminal font, size, cursor style, and selection background', async () => {
    const onChange = vi.fn()
    render(<TerminalGlobalStyleEditor style={globalStyle() as never} onChange={onChange} />)

    await userEvent.clear(screen.getByLabelText('全局终端字体'))
    await userEvent.type(screen.getByLabelText('全局终端字体'), 'JetBrains Mono')
    await userEvent.clear(screen.getByLabelText('全局终端字号'))
    await userEvent.type(screen.getByLabelText('全局终端字号'), '18')
    await userEvent.click(screen.getByRole('combobox', { name: '全局光标样式' }))
    await userEvent.click(await screen.findByRole('option', { name: '下划线' }))
    fireEvent.change(screen.getByLabelText('全局选区背景色 HEX'), { target: { value: '#4f46e5' } })
    fireEvent.change(screen.getByLabelText('全局选区背景色选择器'), { target: { value: '#abcdef' } })

    expect(onChange).toHaveBeenCalledWith('font_family', expect.any(String))
    expect(onChange).toHaveBeenCalledWith('font_size', 18)
    expect(onChange).toHaveBeenCalledWith('cursor_style', 'underline')
    expect(onChange).toHaveBeenCalledWith('selection_background', '#4f46e5')
    expect(onChange).toHaveBeenCalledWith('selection_background', '#abcdef')
  })

  it('disables every field while saving', () => {
    render(<TerminalGlobalStyleEditor style={globalStyle() as never} disabled onChange={vi.fn()} />)

    expect(screen.getByLabelText('全局终端字体')).toBeDisabled()
    expect(screen.getByLabelText('全局终端字号')).toBeDisabled()
    expect(screen.getByRole('combobox', { name: '全局光标样式' })).toBeDisabled()
    expect(screen.getByLabelText('全局选区背景色选择器')).toBeDisabled()
    expect(screen.getByLabelText('全局选区背景色 HEX')).toBeDisabled()
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

  it('reports invalid global selection colors', async () => {
    render(<GlobalStyleHarness />)
    await userEvent.clear(screen.getByLabelText('全局选区背景色 HEX'))
    await userEvent.type(screen.getByLabelText('全局选区背景色 HEX'), 'blue')

    expect(screen.getByLabelText('全局选区背景色 HEX')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('请输入 #RRGGBB 格式')
  })
})

function GlobalStyleHarness() {
  const [style, setStyle] = useState(globalStyle())
  return <TerminalGlobalStyleEditor style={style as never} onChange={(key, value) => setStyle((current) => ({ ...current, [key]: value }))} />
}

function globalStyle() {
  return { font_family: 'Global Font', font_size: 16, cursor_style: 'bar' as const, selection_background: '#264f78' }
}
