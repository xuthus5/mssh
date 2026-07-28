import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Events } from '@wailsio/runtime'
import { KeyManager } from '@/components/settings/KeyManager'
import { useToastStore } from '@/components/ui/toast'
import { SETTINGS_PREVIEW_CANCELLED_EVENT } from '@/lib/settingsWindowEvents'
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

  it('keeps every action on a key row locked while its material is loading', async () => {
    const load = deferred<typeof material>()
    const view = props()
    view.onLoadMaterial = vi.fn(() => load.promise)
    render(<KeyManager {...view} />)

    await userEvent.click(screen.getByRole('button', { name: '查看 generated' }))

    expect(screen.getByRole('button', { name: '查看 generated' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '编辑 generated' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '复制 generated 公钥' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '删除 generated' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '复制 generated 公钥' }))
    expect(view.onExport).not.toHaveBeenCalled()

    await act(async () => { load.resolve(material); await load.promise })
    await waitFor(() => expect(screen.getByRole('button', {
      name: '查看 generated',
      hidden: true,
    })).toBeEnabled())
  })

  it('keeps the latest public key copy result when exports finish out of order', async () => {
    const first = { ...material, id: '7', name: 'first' }
    const second = { ...material, id: '8', name: 'second', publicKey: 'ssh-ed25519 BBBB second' }
    let rejectFirst: ((reason?: unknown) => void) | undefined
    let resolveSecond: ((value: string) => void) | undefined
    const view = props()
    view.keys = [first, second]
    view.onExport = vi.fn((id) => new Promise<string>((resolve, reject) => {
      if (id === first.id) rejectFirst = reject
      else resolveSecond = resolve
    }))
    render(<KeyManager {...view} />)

    await userEvent.click(screen.getByRole('button', { name: '复制 first 公钥' }))
    await userEvent.click(screen.getByRole('button', { name: '复制 second 公钥' }))
    await act(async () => {
      resolveSecond?.(second.publicKey)
      await Promise.resolve()
    })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(second.publicKey)
    await act(async () => {
      rejectFirst?.(new Error('old export failed'))
      await Promise.resolve()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps the latest delete target when usage checks finish out of order', async () => {
    const first = { ...material, id: '7', name: 'first' }
    const second = { ...material, id: '8', name: 'second' }
    const pending = new Map<number, (value: number) => void>()
    __registerHandler('github.com/xuthus5/mssh/internal/service.KeyService.UsageCount', (id: number) => (
      new Promise<number>((resolve) => { pending.set(id, resolve) })
    ))
    const view = props()
    view.keys = [first, second]
    render(<KeyManager {...view} />)

    await userEvent.click(screen.getByRole('button', { name: '删除 first' }))
    await userEvent.click(screen.getByRole('button', { name: '删除 second' }))
    await act(async () => {
      pending.get(8)?.(2)
      await Promise.resolve()
    })
    expect(screen.getByText(/该密钥被 2 个会话引用/)).toBeInTheDocument()
    await act(async () => {
      pending.get(7)?.(0)
      await Promise.resolve()
    })
    expect(screen.getByText(/该密钥被 2 个会话引用/)).toBeInTheDocument()
    expect(screen.queryByText('删除密钥“first”？')).not.toBeInTheDocument()
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
    expect(await screen.findByText('复制私钥失败: clipboard unavailable')).toBeInTheDocument()
    expect(screen.getByText('复制私钥失败: clipboard unavailable').textContent).not.toContain(material.publicKey)
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
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

  it('closes key dialogs and clears private key drafts when the settings window hides', async () => {
    const view = props()
    vi.mocked(view.onSelectImportFile)
      .mockResolvedValueOnce({ name: 'id_ed25519', privateKey: material.privateKey })
      .mockResolvedValueOnce(undefined)
    render(<KeyManager {...view} />)
    await userEvent.click(screen.getByRole('button', { name: '导入' }))
    expect(await screen.findByLabelText('导入私钥内容')).toHaveValue(material.privateKey)

    await act(async () => { await Events.Emit(SETTINGS_PREVIEW_CANCELLED_EVENT, { data: null }) })

    expect(screen.queryByRole('heading', { name: '导入密钥' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '导入' }))
    await waitFor(() => expect(view.onSelectImportFile).toHaveBeenCalledTimes(2))
    expect(screen.getByLabelText('导入私钥内容')).toHaveValue('')
  })

  it('does not reopen key material from a load that finishes after the settings window hides', async () => {
    const load = deferred<typeof material>()
    const view = props()
    view.onLoadMaterial = vi.fn(() => load.promise)
    render(<KeyManager {...view} />)
    await userEvent.click(screen.getByRole('button', { name: '查看 generated' }))

    await act(async () => { await Events.Emit(SETTINGS_PREVIEW_CANCELLED_EVENT, { data: null }) })
    await act(async () => { load.resolve(material); await load.promise })

    expect(screen.queryByRole('heading', { name: '查看密钥' })).not.toBeInTheDocument()
  })

  it('keeps a hidden material request visibly leased until it settles', async () => {
    const load = deferred<typeof material>()
    const view = props()
    view.onLoadMaterial = vi.fn(() => load.promise)
    render(<KeyManager {...view} />)
    await userEvent.click(screen.getByRole('button', { name: '查看 generated' }))

    await act(async () => { await Events.Emit(SETTINGS_PREVIEW_CANCELLED_EVENT, { data: null }) })

    expect(screen.getByRole('button', { name: '查看 generated' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '查看 generated' }))
    expect(view.onLoadMaterial).toHaveBeenCalledOnce()
    await act(async () => { load.resolve(material); await load.promise })
    await waitFor(() => expect(screen.getByRole('button', { name: '查看 generated' })).toBeEnabled())
    expect(screen.queryByRole('heading', { name: '查看密钥' })).not.toBeInTheDocument()
  })

  it('closes an already loaded private key material dialog when the settings window hides', async () => {
    render(<KeyManager {...props()} />)
    await userEvent.click(screen.getByRole('button', { name: '查看 generated' }))
    expect(await screen.findByLabelText('私钥内容')).toHaveValue(material.privateKey)

    await act(async () => { await Events.Emit(SETTINGS_PREVIEW_CANCELLED_EVENT, { data: null }) })

    expect(screen.queryByRole('heading', { name: '查看密钥' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('私钥内容')).not.toBeInTheDocument()
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



  it('keeps delete confirm open and shows inline failure without toast', async () => {
    useToastStore.setState({ toasts: [] })
    const view = props()
    view.onDelete = vi.fn(async () => { throw new Error('delete boom') })
    render(<KeyManager {...view} />)
    await userEvent.click(screen.getByRole('button', { name: '删除 generated' }))
    await userEvent.click(await screen.findByRole('button', { name: '确认删除' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('删除密钥失败: delete boom')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
  })

  it('deduplicates rapid key delete confirmations', async () => {
    const pending = new Promise<void>(() => {})
    const view = props()
    view.onDelete = vi.fn(() => pending)
    render(<KeyManager {...view} />)
    await userEvent.click(screen.getByRole('button', { name: '删除 generated' }))
    const confirm = await screen.findByRole('button', { name: '确认删除' })
    act(() => {
      fireEvent.click(confirm)
      fireEvent.click(confirm)
    })
    expect(view.onDelete).toHaveBeenCalledOnce()
  })

  it('surfaces export failures panel-owned without toast', async () => {
    useToastStore.setState({ toasts: [] })
    const view = props()
    view.onExport = vi.fn(async () => { throw new Error('export boom') })
    render(<KeyManager {...view} />)
    await userEvent.click(screen.getByRole('button', { name: '复制 generated 公钥' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('复制公钥失败: export boom')
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
  })

  it('surfaces generate failures dialog-owned without toast', async () => {
    useToastStore.setState({ toasts: [] })
    const view = props()
    view.onGenerate = vi.fn(async () => { throw new Error('gen boom') })
    render(<KeyManager {...view} />)
    await userEvent.click(screen.getByRole('button', { name: '生成' }))
    await userEvent.type(screen.getByLabelText('密钥名称'), 'x')
    await userEvent.click(screen.getByRole('button', { name: '生成密钥' }))
    expect(await screen.findByText('生成密钥失败: gen boom')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '生成密钥' })).toBeInTheDocument()
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
  })

  it('surfaces import failures dialog-owned without toast', async () => {
    useToastStore.setState({ toasts: [] })
    const view = props()
    view.onImport = vi.fn(async () => { throw new Error('import boom') })
    render(<KeyManager {...view} />)
    await userEvent.click(screen.getByRole('button', { name: '导入' }))
    await waitFor(() => expect(view.onSelectImportFile).toHaveBeenCalled())
    await userEvent.click(screen.getByRole('button', { name: '确认导入' }))
    expect(await screen.findByText('导入密钥失败: import boom')).toBeInTheDocument()
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
  })

  it('surfaces update failures dialog-owned without toast', async () => {
    useToastStore.setState({ toasts: [] })
    const view = props()
    view.onUpdate = vi.fn(async () => { throw new Error('update boom') })
    render(<KeyManager {...view} />)
    await userEvent.click(screen.getByRole('button', { name: '编辑 generated' }))
    await userEvent.click(await screen.findByRole('button', { name: '保存密钥' }))
    expect(await screen.findByText('更新密钥失败: update boom')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '编辑密钥' })).toBeInTheDocument()
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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
