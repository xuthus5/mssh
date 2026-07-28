import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { KeyGenerateDialog, KeyImportDialog, KeyMaterialDialog } from '@/components/settings/KeyDialogs'

const material = { id: '1', name: 'first', type: 'ed25519' as const, bits: 256, publicKey: 'public-1', privateKey: 'private-1', createdAt: '' }

describe('key dialog async target guards', () => {
  it('keeps one file picker lease across import dialog target changes', async () => {
    const firstPicker = deferred<{ name: string; privateKey: string } | undefined>()
    const secondPicker = deferred<{ name: string; privateKey: string } | undefined>()
    const onSelectFile = vi.fn()
      .mockImplementationOnce(() => firstPicker.promise)
      .mockImplementationOnce(() => secondPicker.promise)
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    const view = render(<KeyImportDialog open onOpenChange={onOpenChange} onImport={vi.fn(async () => undefined)} onSelectFile={onSelectFile} />)
    await waitFor(() => expect(onSelectFile).toHaveBeenCalledOnce())
    expect(screen.getByLabelText('导入名称')).toBeDisabled()
    expect(screen.getByLabelText('导入私钥内容')).toBeDisabled()
    expect(screen.getByRole('button', { name: '选择中...' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '确认导入' })).toBeDisabled()
    await expectPendingDialogLocked(user, onOpenChange)

    view.rerender(<KeyImportDialog open={false} onOpenChange={onOpenChange} onImport={vi.fn(async () => undefined)} onSelectFile={onSelectFile} />)
    view.rerender(<KeyImportDialog open onOpenChange={onOpenChange} onImport={vi.fn(async () => undefined)} onSelectFile={onSelectFile} />)
    await act(async () => { await Promise.resolve() })
    expect(onSelectFile).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '选择中...' })).toBeDisabled()

    await act(async () => { firstPicker.resolve({ name: 'old-key', privateKey: 'old-private' }) })
    await waitFor(() => expect(onSelectFile).toHaveBeenCalledTimes(2))
    expect(screen.getByLabelText('导入名称')).not.toHaveValue('old-key')
    await act(async () => { secondPicker.resolve({ name: 'new-key', privateKey: 'new-private' }) })

    expect(screen.getByLabelText('导入名称')).toHaveValue('new-key')
    expect(screen.getByLabelText('导入私钥内容')).toHaveValue('new-private')
  })

  it('keeps import submission single-flight across dialog target changes', async () => {
    const pending = deferred<typeof material | undefined>()
    const onImport = vi.fn()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(undefined)
    const onSelectFile = vi.fn(async () => ({ name: 'imported-key', privateKey: 'imported-private' }))
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    const view = render(<KeyImportDialog open onOpenChange={onOpenChange} onImport={onImport} onSelectFile={onSelectFile} />)
    await waitFor(() => expect(screen.getByLabelText('导入名称')).toHaveValue('imported-key'))
    await user.click(screen.getByRole('button', { name: '确认导入' }))

    expect(screen.getByLabelText('导入名称')).toBeDisabled()
    expect(screen.getByLabelText('导入私钥内容')).toBeDisabled()
    expect(screen.getByRole('button', { name: '选择文件' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '导入中...' })).toBeDisabled()
    await expectPendingDialogLocked(user, onOpenChange)

    view.rerender(<KeyImportDialog open={false} onOpenChange={onOpenChange} onImport={onImport} onSelectFile={onSelectFile} />)
    view.rerender(<KeyImportDialog open onOpenChange={onOpenChange} onImport={onImport} onSelectFile={onSelectFile} />)
    fireEvent.submit(screen.getByRole('button', { name: '导入中...' }).closest('form')!)
    expect(onImport).toHaveBeenCalledOnce()
    expect(onSelectFile).toHaveBeenCalledOnce()

    await act(async () => { pending.resolve(undefined) })
    await waitFor(() => expect(onSelectFile).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByRole('button', { name: '确认导入' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: '确认导入' }))
    expect(onImport).toHaveBeenCalledTimes(2)
  })

  it('locks generation until the original request settles', async () => {
    const pending = deferred<typeof material | undefined>()
    const onGenerate = vi.fn()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(undefined)
    const onOpenChange = vi.fn()
    const onGenerated = vi.fn()
    const user = userEvent.setup()
    const view = render(<KeyGenerateDialog open onOpenChange={onOpenChange} onGenerate={onGenerate} onGenerated={onGenerated} />)
    await user.type(screen.getByLabelText('密钥名称'), 'old-key')
    await user.click(screen.getByRole('button', { name: '生成密钥' }))
    expect(screen.getByLabelText('密钥名称')).toBeDisabled()
    expect(screen.getByLabelText('密钥类型')).toBeDisabled()
    expect(screen.getByLabelText('密钥位数')).toBeDisabled()
    expect(screen.getByRole('button', { name: '生成中...' })).toBeDisabled()
    await expectPendingDialogLocked(user, onOpenChange)

    view.rerender(<KeyGenerateDialog open={false} onOpenChange={onOpenChange} onGenerate={onGenerate} onGenerated={onGenerated} />)
    view.rerender(<KeyGenerateDialog open onOpenChange={onOpenChange} onGenerate={onGenerate} onGenerated={onGenerated} />)
    fireEvent.submit(screen.getByRole('button', { name: '生成中...' }).closest('form')!)
    expect(onGenerate).toHaveBeenCalledOnce()
    await act(async () => { pending.resolve(material) })

    expect(onGenerated).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    await waitFor(() => expect(screen.getByRole('button', { name: '生成密钥' })).toBeEnabled())
    await user.type(screen.getByLabelText('密钥名称'), 'new-key')
    await user.click(screen.getByRole('button', { name: '生成密钥' }))
    expect(onGenerate).toHaveBeenCalledTimes(2)
  })

  it('locks material editing across target changes until save settles', async () => {
    const pending = deferred<typeof material | undefined>()
    const onUpdate = vi.fn()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(undefined)
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    const firstState = { mode: 'edit' as const, material }
    const secondState = { mode: 'edit' as const, material: { ...material, id: '2', name: 'second', privateKey: 'private-2' } }
    const view = render(<KeyMaterialDialog state={firstState} onOpenChange={onOpenChange} onUpdate={onUpdate} />)
    await user.click(screen.getByRole('button', { name: '保存密钥' }))
    expect(screen.getByLabelText('密钥名称')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('公钥内容')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('私钥内容')).toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: '复制公钥' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '复制私钥' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '保存中...' })).toBeDisabled()
    await expectPendingDialogLocked(user, onOpenChange)

    view.rerender(<KeyMaterialDialog state={secondState} onOpenChange={onOpenChange} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByRole('button', { name: '保存中...' }))
    expect(onUpdate).toHaveBeenCalledOnce()
    await act(async () => { pending.resolve(material) })

    expect(screen.getByLabelText('密钥名称')).toHaveValue('second')
    expect(screen.getByLabelText('私钥内容')).toHaveValue('private-2')
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    await waitFor(() => expect(screen.getByRole('button', { name: '保存密钥' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: '保存密钥' }))
    expect(onUpdate).toHaveBeenCalledTimes(2)
  })
})

async function expectPendingDialogLocked(user: ReturnType<typeof userEvent.setup>, onOpenChange: ReturnType<typeof vi.fn>) {
  expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
  await user.keyboard('{Escape}')
  const overlay = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')
  expect(overlay).not.toBeNull()
  await user.click(overlay!)
  expect(onOpenChange).not.toHaveBeenCalledWith(false)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
