import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { AIProviderAdvancedFields } from '@/components/settings/AIProviderAdvancedFields'
import { AIProviderType, type AIProviderProfileInput, type ModelsDevModel } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

function baseDraft(): AIProviderProfileInput {
  return { id: 0, name: '', provider: AIProviderType.AIProviderOpenAICompatible, base_url: '', default_model: '', enabled: true, api_key: '', context_window_size: 0, skip_tls_verify: false, max_tokens: 0, temperature: null, top_p: null, frequency_penalty: null, presence_penalty: null, custom_headers: {} }
}

function Harness() {
  const [draft, setDraft] = useState(baseDraft())
  const update = (fn: (c: AIProviderProfileInput) => AIProviderProfileInput) => setDraft(fn)
  return <AIProviderAdvancedFields draft={draft} update={update} />
}

function PresetHarness() {
  const [draft, setDraft] = useState(baseDraft())
  const model = { id: 'model', name: 'Model', context_window_size: 64000, max_tokens: 4096, temperature_supported: true } as ModelsDevModel
  return <AIProviderAdvancedFields draft={draft} update={setDraft} model={model} />
}

describe('AIProviderAdvancedFields', () => {
  it('expands and edits numeric advanced params', async () => {
    const user = userEvent.setup()
    let draft = baseDraft()
    const update = (fn: (c: AIProviderProfileInput) => AIProviderProfileInput) => { draft = fn(draft) }
    render(<AIProviderAdvancedFields draft={draft} update={update} />)
    await user.click(screen.getByText('高级参数'))
    fireEvent.change(screen.getByLabelText('最大 Token 数'), { target: { value: '2048' } })
    expect(draft.max_tokens).toBe(2048)
    fireEvent.change(screen.getByLabelText('Temperature'), { target: { value: '0.7' } })
    expect(draft.temperature).toBe(0.7)
  })

  it('toggles skip TLS verify switch', async () => {
    const user = userEvent.setup()
    let draft = baseDraft()
    const update = (fn: (c: AIProviderProfileInput) => AIProviderProfileInput) => { draft = fn(draft) }
    render(<AIProviderAdvancedFields draft={draft} update={update} />)
    await user.click(screen.getByText('高级参数'))
    await user.click(screen.getByRole('switch', { name: '跳过 TLS 证书校验' }))
    expect(draft.skip_tls_verify).toBe(true)
  })

  it('applies model and sampling parameter presets', async () => {
    const user = userEvent.setup()
    render(<PresetHarness />)
    await user.click(screen.getByText('高级参数'))
    await user.click(screen.getByRole('combobox', { name: 'Temperature 快速选择' }))
    await user.click(await screen.findByRole('option', { name: '0.7' }))
    expect(screen.getByLabelText('Temperature')).toHaveValue(0.7)
    await user.click(screen.getByRole('combobox', { name: '上下文窗口大小 快速选择' }))
    await user.click(await screen.findByRole('option', { name: '模型值 64,000' }))
    expect(screen.getByLabelText('上下文窗口大小')).toHaveValue(64000)
  })

  it('adds and removes custom headers', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText('高级参数'))
    fireEvent.change(screen.getByLabelText('头信息名称'), { target: { value: 'X-Test' } })
    fireEvent.change(screen.getByLabelText('头信息值'), { target: { value: 'abc' } })
    await user.click(screen.getByRole('button', { name: '添加' }))
    expect(screen.getByText('X-Test')).toBeInTheDocument()
    const removeBtn = screen.getByRole('button', { name: '删除头信息' })
    await user.click(removeBtn)
    expect(screen.queryByText('X-Test')).not.toBeInTheDocument()
  })
})
