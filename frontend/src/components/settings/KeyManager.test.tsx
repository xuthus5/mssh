import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { KeyManager } from '@/components/settings/KeyManager'
import { useToastStore } from '@/components/ui/toast'
import { __clearHandlers, __registerHandler } from '@/test/__mocks__/wails-runtime'

const material = {
  id: '7', name: 'generated', type: 'ed25519' as const, bits: 256,
  publicKey: 'ssh-ed25519 AAAA generated', privateKey: '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----\n',
  createdAt: '2026-07-15T00:00:00Z',
}

function props(): ComponentProps<typeof KeyManager> {
  const { privateKey: _privateKey, ...key } = material
  return {
    keys: [key],
    onGenerate: vi.fn(async () => material), onImport: vi.fn(async () => key),
    onDelete: vi.fn(), onExport: vi.fn(async () => material.publicKey),
    onLoadMaterial: vi.fn(async () => material), onUpdate: vi.fn(async () => material),
    onSelectImportFile: vi.fn(async () => ({ name: 'id_ed25519', privateKey: material.privateKey })),
  }
}

describe('KeyManager', () => {
  beforeEach(() => {
    __clearHandlers()
    __registerHandler('github.com/xuthus5/mssh/internal/service.KeyService.UsageCount', async () => 0)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => {}) } })
    useToastStore.setState({ toasts: [] })
  })

  it('shows and copies generated public and private key material', async () => {
    const view = props()
    render(<KeyManager {...view} />)

    await userEvent.click(screen.getByRole('button', { name: '生成' }))
    await userEvent.type(screen.getByLabelText('密钥名称'), 'generated')
    await userEvent.click(screen.getByRole('button', { name: '生成密钥' }))

    expect(await screen.findByRole('heading', { name: '密钥已生成' })).toBeInTheDocument()
    expect(screen.getByLabelText('私钥内容')).toHaveValue(material.privateKey)
    expect(screen.getByLabelText('公钥内容')).toHaveValue(material.publicKey)
    await userEvent.click(screen.getByRole('button', { name: '复制私钥' }))
    await userEvent.click(screen.getByRole('button', { name: '复制公钥' }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(material.privateKey)
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(material.publicKey)
  })

  it('loads and edits an existing public/private key pair', async () => {
    const view = props()
    render(<KeyManager {...view} />)

    await userEvent.click(screen.getByRole('button', { name: '编辑 generated' }))
    expect(await screen.findByRole('heading', { name: '编辑密钥' })).toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('密钥名称'))
    await userEvent.type(screen.getByLabelText('密钥名称'), 'updated')
    await userEvent.clear(screen.getByLabelText('公钥内容'))
    await userEvent.type(screen.getByLabelText('公钥内容'), 'ssh-ed25519 BBBB updated')
    await userEvent.clear(screen.getByLabelText('私钥内容'))
    await userEvent.type(screen.getByLabelText('私钥内容'), 'updated private key')
    await userEvent.click(screen.getByRole('button', { name: '保存密钥' }))

    expect(view.onLoadMaterial).toHaveBeenCalledWith('7')
    expect(view.onUpdate).toHaveBeenCalledWith(expect.objectContaining({
      id: '7', name: 'updated', publicKey: 'ssh-ed25519 BBBB updated', privateKey: 'updated private key',
    }))
  })

  it('views an existing pair without allowing edits', async () => {
    const view = props()
    render(<KeyManager {...view} />)

    await userEvent.click(screen.getByRole('button', { name: '查看 generated' }))

    expect(await screen.findByRole('heading', { name: '查看密钥' })).toBeInTheDocument()
    expect(screen.getByLabelText('密钥名称')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('公钥内容')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('私钥内容')).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: '保存密钥' })).not.toBeInTheDocument()
  })

  it('keeps the latest material request when responses arrive out of order', async () => {
    const first = { ...material, id: '7', name: 'first' }
    const second = { ...material, id: '8', name: 'second' }
    let resolveFirst: ((value: typeof first) => void) | undefined
    let resolveSecond: ((value: typeof second) => void) | undefined
    const view = props()
    view.keys = [first, second]
    vi.mocked(view.onLoadMaterial).mockImplementation((id) => new Promise((resolve) => {
      if (id === '7') resolveFirst = resolve
      else resolveSecond = resolve
    }))
    render(<KeyManager {...view} />)

    await userEvent.click(screen.getByRole('button', { name: '查看 first' }))
    await userEvent.click(screen.getByRole('button', { name: '编辑 second' }))
    if (!resolveFirst || !resolveSecond) throw new Error('material requests did not start')
    const completeFirst = resolveFirst
    const completeSecond = resolveSecond
    await act(async () => { completeSecond(second) })
    expect(await screen.findByRole('heading', { name: '编辑密钥' })).toBeInTheDocument()
    expect(screen.getByLabelText('密钥名称')).toHaveValue('second')
    await act(async () => { completeFirst(first) })
    expect(screen.getByLabelText('密钥名称')).toHaveValue('second')
  })

  it('copies the listed public key and deletes the selected key', async () => {
    const view = props()
    render(<KeyManager {...view} />)

    await userEvent.click(screen.getByRole('button', { name: '复制 generated 公钥' }))
    await userEvent.click(screen.getByRole('button', { name: '删除 generated' }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '确认删除' }))

    expect(view.onExport).toHaveBeenCalledWith('7')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(material.publicKey)
    expect(view.onDelete).toHaveBeenCalledWith('7')
  })

  it('reports clipboard errors without exposing key material in the message', async () => {
    const view = props()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => { throw new Error('clipboard unavailable') }) },
    })
    render(<KeyManager {...view} />)

    await userEvent.click(screen.getByRole('button', { name: '复制 generated 公钥' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('复制公钥失败: clipboard unavailable')
    expect(screen.getByRole('alert').textContent).not.toContain(material.publicKey)
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)

    await userEvent.click(screen.getByRole('button', { name: '查看 generated' }))
    await userEvent.click(await screen.findByRole('button', { name: '复制私钥' }))
    await waitFor(() => expect(useToastStore.getState().toasts).toContainEqual(expect.objectContaining({
      type: 'error', message: '复制私钥失败: clipboard unavailable',
    })))
    expect(useToastStore.getState().toasts[0]?.message).not.toContain(material.publicKey)
  })

  it('keeps dialogs open when generation, loading, or updating returns no result', async () => {
    const view = props()
    vi.mocked(view.onGenerate).mockResolvedValueOnce(undefined)
    vi.mocked(view.onLoadMaterial).mockResolvedValueOnce(undefined)
    vi.mocked(view.onUpdate).mockResolvedValueOnce(undefined)
    render(<KeyManager {...view} />)

    await userEvent.click(screen.getByRole('button', { name: '生成' }))
    await userEvent.type(screen.getByLabelText('密钥名称'), 'missing')
    await userEvent.click(screen.getByRole('combobox', { name: '密钥类型' }))
    await userEvent.click(await screen.findByRole('option', { name: 'RSA' }))
    expect(screen.getByRole('combobox', { name: '密钥位数' })).toHaveTextContent('2048')
    await userEvent.click(screen.getByRole('button', { name: '生成密钥' }))
    expect(screen.getByRole('heading', { name: '生成密钥' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')

    await userEvent.click(screen.getByRole('button', { name: '查看 generated' }))
    expect(screen.queryByRole('heading', { name: '查看密钥' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '编辑 generated' }))
    await userEvent.click(await screen.findByRole('button', { name: '保存密钥' }))
    expect(screen.getByRole('heading', { name: '编辑密钥' })).toBeInTheDocument()
  })

  it('opens import from the SSH directory selection and prefills the file', async () => {
    const view = props()
    render(<KeyManager {...view} />)

    await userEvent.click(screen.getByRole('button', { name: '导入' }))

    await waitFor(() => expect(view.onSelectImportFile).toHaveBeenCalledOnce())
    expect(await screen.findByLabelText('导入名称')).toHaveValue('id_ed25519')
    expect(screen.getByLabelText('导入私钥内容')).toHaveValue(material.privateKey)
    await userEvent.click(screen.getByRole('button', { name: '确认导入' }))
    expect(view.onImport).toHaveBeenCalledWith('id_ed25519', material.privateKey)
  })

  it('allows choosing another import file and manual content editing', async () => {
    const view = props()
    vi.mocked(view.onSelectImportFile)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ name: 'id_rsa', privateKey: 'selected private key' })
    vi.mocked(view.onImport).mockResolvedValueOnce(undefined)
    render(<KeyManager {...view} />)

    await userEvent.click(screen.getByRole('button', { name: '导入' }))
    await waitFor(() => expect(view.onSelectImportFile).toHaveBeenCalledOnce())
    await userEvent.click(screen.getByRole('button', { name: '选择文件' }))
    expect(await screen.findByLabelText('导入名称')).toHaveValue('id_rsa')
    await userEvent.clear(screen.getByLabelText('导入名称'))
    await userEvent.type(screen.getByLabelText('导入名称'), 'custom-name')
    await userEvent.clear(screen.getByLabelText('导入私钥内容'))
    await userEvent.type(screen.getByLabelText('导入私钥内容'), 'custom private key')
    await userEvent.click(screen.getByRole('button', { name: '确认导入' }))

    expect(view.onImport).toHaveBeenCalledWith('custom-name', 'custom private key')
    expect(screen.getByRole('heading', { name: '导入密钥' })).toBeInTheDocument()
  })

  it('surfaces key material load failures panel-owned without toast', async () => {
    useToastStore.setState({ toasts: [] })
    const view = props()
    view.onLoadMaterial = vi.fn(async () => { throw new Error('vault locked') })
    render(<KeyManager {...view} />)
    await userEvent.click(screen.getByRole('button', { name: '查看 generated' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('读取密钥失败: vault locked')
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
  })

  it('surfaces empty key material as a panel-owned visible failure', async () => {
    useToastStore.setState({ toasts: [] })
    const view = props()
    view.onLoadMaterial = vi.fn(async () => undefined)
    render(<KeyManager {...view} />)
    await userEvent.click(screen.getByRole('button', { name: '编辑 generated' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('读取密钥失败')
    expect(screen.queryByRole('heading', { name: '编辑密钥' })).not.toBeInTheDocument()
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
  })

  it('surfaces key usage analysis failures panel-owned without toast', async () => {
    useToastStore.setState({ toasts: [] })
    __registerHandler('github.com/xuthus5/mssh/internal/service.KeyService.UsageCount', async () => {
      throw new Error('usage boom')
    })
    const view = props()
    render(<KeyManager {...view} />)
    await userEvent.click(screen.getByRole('button', { name: '删除 generated' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('分析密钥影响失败: usage boom')
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
  })


  it('shows load failures instead of empty keys', async () => {
    const onReload = vi.fn(async () => {})
    render(<KeyManager {...props()} keys={[]} loadError="list boom" loading={false} onReload={onReload} />)
    expect(screen.getByRole('alert')).toHaveTextContent('list boom')
    expect(screen.queryByText('无密钥')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(onReload).toHaveBeenCalled()
  })

})
