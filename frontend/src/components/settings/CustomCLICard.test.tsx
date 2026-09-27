import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CustomCLICard } from '@/components/settings/CustomCLICard'

const emptyAgent = { default_engine: 'native', default_cli: 'codex', allow_codex: false, custom_clis: [] }

function entry(overrides: Record<string, unknown>) {
  return { id: 'one', name: 'Mine', command: 'cmdc', args: [], env: [], prompt_mode: 'stdin', version_arg: '', ...overrides }
}

describe('CustomCLICard', () => {
  it('shows an empty state and appends a new entry when adding', async () => {
    const setAgent = vi.fn()
    render(<CustomCLICard agent={emptyAgent as never} setAgent={setAgent} />)
    expect(screen.getByText('还没有自定义 CLI，点击“添加自定义 CLI”开始配置。')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '添加自定义 CLI' }))

    const added = setAgent.mock.calls[0][0].custom_clis
    expect(added).toHaveLength(1)
    expect(added[0].id).toBeTruthy()
    expect(added[0].prompt_mode).toBe('stdin')
  })

  it('lists multiple custom CLIs and removes the selected one', async () => {
    const setAgent = vi.fn()
    const entries = [entry({}), entry({ id: 'two', name: 'Other', command: 'cmd-two', prompt_mode: 'arg' })]
    render(<CustomCLICard agent={{ ...emptyAgent, custom_clis: entries } as never} setAgent={setAgent} />)

    expect(screen.getByText('Mine')).toBeInTheDocument()
    expect(screen.getByText('Other')).toBeInTheDocument()

    await userEvent.click(screen.getAllByRole('button', { name: '删除自定义 CLI' })[0])

    expect(setAgent).toHaveBeenCalledWith({ custom_clis: [entries[1]] })
  })

  it('keeps a new line while typing multiple arguments', async () => {
    const setAgent = vi.fn()
    render(<CustomCLICard agent={{ ...emptyAgent, custom_clis: [entry({})] } as never} setAgent={setAgent} />)

    await userEvent.type(screen.getByLabelText('参数（每行一个）'), '-p{enter}--yolo')

    expect(screen.getByLabelText('参数（每行一个）')).toHaveValue('-p\n--yolo')
    expect(setAgent).toHaveBeenLastCalledWith({ custom_clis: [entry({ args: ['-p', '--yolo'] })] })
  })
})
