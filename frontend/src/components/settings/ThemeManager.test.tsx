import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Events } from '@wailsio/runtime'

const { openFile } = vi.hoisted(() => ({ openFile: vi.fn(async () => ['/tmp/a.itermcolors', '/tmp/b.itermcolors']) }))
vi.mock('@wailsio/runtime', async (importOriginal) => {
  const runtime = await importOriginal<typeof import('@wailsio/runtime')>()
  return { ...runtime, Dialogs: { ...runtime.Dialogs, OpenFile: openFile } }
})
const notify = vi.hoisted(() => vi.fn())
vi.mock('@/components/ui/toast', () => ({ toast: (...args: unknown[]) => notify(...args) }))

import { ThemeManager } from '@/components/settings/ThemeManager'
import { SETTINGS_PREVIEW_CANCELLED_EVENT } from '@/lib/settingsWindowEvents'

describe('ThemeManager', () => {
  it('imports multiple iTerm2 schemes and shows structured results', async () => {
    const onImport = vi.fn(async () => ({
      results: [
        { file: '/tmp/a.itermcolors', name: 'A', status: 'imported', definition_id: 3, profile_id: 3, error: '' },
        { file: '/tmp/b.itermcolors', name: 'B', status: 'duplicate', definition_id: 4, profile_id: 0, error: '' },
      ],
    }))
    render(
      <ThemeManager
        profiles={profiles as never}
        onImport={onImport as never}
        onDeleteProfile={vi.fn()}
        onDeleteDefinition={vi.fn()}
        onCreateProfile={vi.fn()}
        onUpdateProfile={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '导入 iTerm2 主题' }))
    expect(openFile).toHaveBeenCalledWith(expect.objectContaining({ AllowsMultipleSelection: true, CanChooseDirectories: false }))
    expect(onImport).toHaveBeenCalledWith(['/tmp/a.itermcolors', '/tmp/b.itermcolors'])
    expect(await screen.findByText('已导入')).toBeInTheDocument()
    expect(screen.getByText('已存在')).toBeInTheDocument()
  })

  it('filters themes and exposes a single delete action', async () => {
    render(
      <ThemeManager
        profiles={profiles as never}
        onImport={vi.fn()}
        onDeleteProfile={vi.fn()}
        onDeleteDefinition={vi.fn()}
        onCreateProfile={vi.fn()}
        onUpdateProfile={vi.fn()}
      />,
    )
    await userEvent.type(screen.getByLabelText('搜索终端主题'), 'Light')
    expect(screen.getByText('GitHub Light')).toBeInTheDocument()
    expect(screen.queryByText('GitHub Dark')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除 GitHub Light' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: '删除 GitHub Light Profile' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '删除 GitHub Light 主题定义' })).not.toBeInTheDocument()
  })

  it('discards row edits and delete confirmation when the settings window hides', async () => {
    const onUpdateProfile = vi.fn(async () => {})
    render(
      <ThemeManager
        profiles={profiles as never}
        onImport={vi.fn()}
        onDeleteProfile={vi.fn()}
        onDeleteDefinition={vi.fn()}
        onCreateProfile={vi.fn()}
        onUpdateProfile={onUpdateProfile}
      />,
    )

    await userEvent.click(screen.getAllByRole('button', { name: '重命名' })[0])
    await userEvent.clear(screen.getByLabelText('重命名 GitHub Dark'))
    await userEvent.type(screen.getByLabelText('重命名 GitHub Dark'), 'Unsaved')
    await act(async () => { await Events.Emit(SETTINGS_PREVIEW_CANCELLED_EVENT, { data: null }) })
    expect(screen.queryByLabelText('重命名 GitHub Dark')).not.toBeInTheDocument()

    await userEvent.click(screen.getAllByRole('button', { name: '重命名' })[0])
    expect(screen.getByLabelText('重命名 GitHub Dark')).toHaveValue('GitHub Dark')
    await act(async () => { await Events.Emit(SETTINGS_PREVIEW_CANCELLED_EVENT, { data: null }) })
    await userEvent.click(screen.getByRole('button', { name: '删除 GitHub Dark' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    await act(async () => { await Events.Emit(SETTINGS_PREVIEW_CANCELLED_EVENT, { data: null }) })

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onUpdateProfile).not.toHaveBeenCalled()
  })

  it('keeps a confirmed theme deletion running after the settings window hides', async () => {
    let resolveDelete: (() => void) | undefined
    const onDeleteProfile = vi.fn(() => new Promise<void>((resolve) => { resolveDelete = resolve }))
    render(
      <ThemeManager
        profiles={[profiles[0]] as never}
        onImport={vi.fn()}
        onDeleteProfile={onDeleteProfile}
        onDeleteDefinition={vi.fn()}
        onCreateProfile={vi.fn()}
        onUpdateProfile={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: '删除 GitHub Dark' }))
    await userEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await act(async () => { await Events.Emit(SETTINGS_PREVIEW_CANCELLED_EVENT, { data: null }) })

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onDeleteProfile).toHaveBeenCalledOnce()
    await act(async () => { resolveDelete?.(); await Promise.resolve() })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renames, copies, and deletes custom themes through AlertDialog', async () => {
    const update = vi.fn(async () => {})
    const create = vi.fn(async () => {})
    const deleteProfile = vi.fn(async () => {})
    const deleteDefinition = vi.fn(async () => {})
    const custom = {
      ...profile(3, 'Custom', 'dark'),
      definition: { ...profile(3, 'Custom', 'dark').definition, is_builtin: false, source_type: 'custom' },
    }
    render(
      <ThemeManager
        profiles={[custom] as never}
        onImport={vi.fn()}
        onDeleteProfile={deleteProfile}
        onDeleteDefinition={deleteDefinition}
        onCreateProfile={create}
        onUpdateProfile={update}
      />,
    )

    await userEvent.click(screen.getAllByRole('button', { name: '重命名' })[0])
    await userEvent.clear(screen.getByLabelText('重命名 Custom'))
    await userEvent.type(screen.getByLabelText('重命名 Custom'), 'Renamed')
    await userEvent.click(screen.getByRole('button', { name: '保存名称' }))
    await userEvent.click(screen.getByRole('button', { name: '复制 Custom' }))
    await userEvent.click(screen.getByRole('button', { name: '删除 Custom' }))

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText('删除主题「Custom」？')).toBeInTheDocument()
    expect(screen.getByText(/将移除该主题配置/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '确认删除' }))

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ name: 'Renamed', follow_global_style: true }))
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ id: 0, follow_global_style: true }))
    expect(deleteProfile).toHaveBeenCalledWith(3)
    expect(deleteDefinition).toHaveBeenCalledWith(3)
  })

  it('keeps built-in definitions when deleting a profile', async () => {
    const deleteProfile = vi.fn(async () => {})
    const deleteDefinition = vi.fn(async () => {})
    render(
      <ThemeManager
        profiles={[profiles[0]] as never}
        onImport={vi.fn()}
        onDeleteProfile={deleteProfile}
        onDeleteDefinition={deleteDefinition}
        onCreateProfile={vi.fn()}
        onUpdateProfile={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '删除 GitHub Dark' }))
    expect(await screen.findByText(/内置颜色定义会保留/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '确认删除' }))
    expect(deleteProfile).toHaveBeenCalledWith(1)
    expect(deleteDefinition).not.toHaveBeenCalled()
  })


  it('surfaces theme file picker failures panel-owned without toast', async () => {
    openFile.mockRejectedValueOnce(new Error('picker unavailable'))
    const onImport = vi.fn(async () => ({ results: [] }))
    render(
      <ThemeManager
        profiles={profiles as never}
        onImport={onImport as never}
        onDeleteProfile={vi.fn()}
        onDeleteDefinition={vi.fn()}
        onCreateProfile={vi.fn()}
        onUpdateProfile={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '导入 iTerm2 主题' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('选择主题文件失败: picker unavailable')
    expect(notify).not.toHaveBeenCalled()
    expect(onImport).not.toHaveBeenCalled()
  })

  it('surfaces theme mutation failures panel-owned without toast', async () => {
    const onUpdateProfile = vi.fn(async () => { throw new Error('rename boom') })
    render(
      <ThemeManager
        profiles={profiles as never}
        onImport={vi.fn()}
        onDeleteProfile={vi.fn()}
        onDeleteDefinition={vi.fn()}
        onCreateProfile={vi.fn()}
        onUpdateProfile={onUpdateProfile}
      />,
    )
    await userEvent.click(screen.getAllByRole('button', { name: '重命名' })[0])
    await userEvent.clear(screen.getByLabelText('重命名 GitHub Dark'))
    await userEvent.type(screen.getByLabelText('重命名 GitHub Dark'), 'Renamed')
    await userEvent.click(screen.getByRole('button', { name: '保存名称' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('主题操作失败: rename boom')
    expect(notify).not.toHaveBeenCalled()
  })

  it('ignores referenced definition cleanup conflicts after profile delete', async () => {
    const deleteProfile = vi.fn(async () => {})
    const deleteDefinition = vi.fn(async () => {
      throw new Error('theme definition is referenced by 1 profiles')
    })
    const custom = {
      ...profile(4, 'Shared', 'dark'),
      definition: { ...profile(4, 'Shared', 'dark').definition, is_builtin: false, source_type: 'custom' },
    }
    render(
      <ThemeManager
        profiles={[custom] as never}
        onImport={vi.fn()}
        onDeleteProfile={deleteProfile}
        onDeleteDefinition={deleteDefinition}
        onCreateProfile={vi.fn()}
        onUpdateProfile={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '删除 Shared' }))
    await userEvent.click(await screen.findByRole('button', { name: '确认删除' }))
    expect(deleteProfile).toHaveBeenCalledWith(4)
    expect(deleteDefinition).toHaveBeenCalledWith(4)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('surfaces unexpected definition cleanup failures after profile delete', async () => {
    notify.mockClear()
    const deleteProfile = vi.fn(async () => {})
    const deleteDefinition = vi.fn(async () => {
      throw new Error('database unavailable')
    })
    render(
      <ThemeManager
        profiles={[profile(5, 'Broken Cleanup', 'dark', false)] as never}
        onImport={vi.fn()}
        onDeleteProfile={deleteProfile}
        onDeleteDefinition={deleteDefinition}
        onCreateProfile={vi.fn()}
        onUpdateProfile={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '删除 Broken Cleanup' }))
    await userEvent.click(await screen.findByRole('button', { name: '确认删除' }))
    expect(deleteProfile).toHaveBeenCalledWith(5)
    expect(deleteDefinition).toHaveBeenCalledWith(5)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '主题配置已删除，但清理颜色定义失败: database unavailable',
    )
    expect(notify).not.toHaveBeenCalled()
  })
  it('keeps delete confirm open and shows inline failure without toast', async () => {
    notify.mockClear()
    const onDeleteProfile = vi.fn(async () => { throw new Error('delete boom') })
    render(
      <ThemeManager
        profiles={[profile(9, 'Custom', 'light', false)] as never}
        onImport={vi.fn()}
        onDeleteProfile={onDeleteProfile}
        onDeleteDefinition={vi.fn()}
        onCreateProfile={vi.fn()}
        onUpdateProfile={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '删除 Custom' }))
    await userEvent.click(await screen.findByRole('button', { name: '确认删除' }))
    expect(await screen.findByText('主题操作失败: delete boom')).toBeInTheDocument()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(notify).not.toHaveBeenCalled()
  })

  it('keeps an older row failure visible after a different row succeeds', async () => {
    let rejectRename: ((reason?: unknown) => void) | undefined
    let resolveCopy: (() => void) | undefined
    const update = vi.fn(() => new Promise<void>((_, reject) => { rejectRename = reject }))
    const create = vi.fn(() => new Promise<void>((resolve) => { resolveCopy = resolve }))
    render(
      <ThemeManager
        profiles={profiles as never}
        onImport={vi.fn()}
        onDeleteProfile={vi.fn()}
        onDeleteDefinition={vi.fn()}
        onCreateProfile={create}
        onUpdateProfile={update}
      />,
    )
    await userEvent.click(screen.getAllByRole('button', { name: '重命名' })[0])
    await userEvent.click(screen.getByRole('button', { name: '保存名称' }))
    await userEvent.click(screen.getByRole('button', { name: '复制 GitHub Light' }))
    await act(async () => {
      resolveCopy?.()
      await Promise.resolve()
    })
    await act(async () => {
      rejectRename?.(new Error('old rename failed'))
      await Promise.resolve()
    })
    expect(screen.getByRole('alert')).toHaveTextContent('主题操作失败: old rename failed')
  })

  it('locks a theme row and catalog-wide actions while its rename is pending', async () => {
    const renaming = deferred<void>()
    const create = vi.fn(async () => undefined)
    const custom = profile(9, 'Custom', 'light', false)
    render(
      <ThemeManager
        profiles={[custom] as never}
        onImport={vi.fn()}
        onDeleteProfile={vi.fn()}
        onDeleteDefinition={vi.fn()}
        onCreateProfile={create}
        onUpdateProfile={vi.fn(() => renaming.promise)}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '重命名' }))
    await userEvent.click(screen.getByRole('button', { name: '保存名称' }))

    const nameInput = screen.getByLabelText('重命名 Custom')
    const copy = screen.getByRole('button', { name: '复制 Custom' })
    const remove = screen.getByRole('button', { name: '删除 Custom' })
    expect(nameInput.closest('tr')).toHaveAttribute('aria-busy', 'true')
    expect(nameInput).toBeDisabled()
    expect(screen.getByRole('button', { name: '保存名称' })).toBeDisabled()
    expect(copy).toBeDisabled()
    expect(remove).toBeDisabled()
    expect(screen.getByRole('button', { name: '导入 iTerm2 主题' })).toBeDisabled()
    fireEvent.click(copy)
    fireEvent.click(remove)
    expect(create).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    await act(async () => { renaming.resolve(); await renaming.promise })
    await waitFor(() => expect(screen.getByRole('button', { name: '复制 Custom' })).toBeEnabled())
  })

  it('opens only one theme picker while an import is pending', async () => {
    let resolvePicker: ((paths: string[]) => void) | undefined
    openFile.mockClear()
    openFile.mockImplementationOnce(() => new Promise((resolve) => { resolvePicker = resolve }))
    const onImport = vi.fn(async (paths: string[]) => ({
      results: [{ file: paths[0], name: 'Latest', status: 'imported', definition_id: 8, profile_id: 8, error: '' }],
    }))
    render(
      <ThemeManager
        profiles={profiles as never}
        onImport={onImport as never}
        onDeleteProfile={vi.fn()}
        onDeleteDefinition={vi.fn()}
        onCreateProfile={vi.fn()}
        onUpdateProfile={vi.fn()}
      />,
    )
    const importButton = screen.getByRole('button', { name: '导入 iTerm2 主题' })
    act(() => {
      fireEvent.click(importButton)
      fireEvent.click(importButton)
    })
    expect(openFile).toHaveBeenCalledOnce()
    await act(async () => {
      resolvePicker?.(['/tmp/latest.itermcolors'])
      await Promise.resolve()
    })
    expect(await screen.findByText('Latest')).toBeInTheDocument()
  })

  it('ignores a theme picker result that arrives after the settings window hides', async () => {
    let resolvePicker: ((paths: string[]) => void) | undefined
    openFile.mockImplementationOnce(() => new Promise((resolve) => { resolvePicker = resolve }))
    const onImport = vi.fn(async () => ({ results: [] }))
    render(
      <ThemeManager
        profiles={profiles as never}
        onImport={onImport as never}
        onDeleteProfile={vi.fn()}
        onDeleteDefinition={vi.fn()}
        onCreateProfile={vi.fn()}
        onUpdateProfile={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: '导入 iTerm2 主题' }))
    expect(screen.getByRole('button', { name: '导入中…' })).toBeDisabled()
    await act(async () => { await Events.Emit(SETTINGS_PREVIEW_CANCELLED_EVENT, { data: null }) })
    await act(async () => { resolvePicker?.(['/tmp/stale.itermcolors']); await Promise.resolve() })

    expect(onImport).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '导入 iTerm2 主题' })).toBeEnabled()
  })


  it('deduplicates rapid theme delete confirmations', async () => {
    const pending = new Promise<void>(() => {})
    const onDeleteProfile = vi.fn(() => pending)
    render(
      <ThemeManager
        profiles={[profile(9, 'Custom', 'light', false)] as never}
        onImport={vi.fn()}
        onDeleteProfile={onDeleteProfile}
        onDeleteDefinition={vi.fn()}
        onCreateProfile={vi.fn()}
        onUpdateProfile={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '删除 Custom' }))
    const confirm = await screen.findByRole('button', { name: '确认删除' })
    act(() => {
      fireEvent.click(confirm)
      fireEvent.click(confirm)
    })
    expect(onDeleteProfile).toHaveBeenCalledOnce()
  })

  it('keeps theme deletion locked after the settings window hides', async () => {
    const deleting = deferred<void>()
    const onDeleteProfile = vi.fn()
      .mockImplementationOnce(() => deleting.promise)
      .mockResolvedValueOnce(undefined)
    render(
      <ThemeManager
        profiles={[profile(9, 'First', 'light', false), profile(10, 'Second', 'dark', false)] as never}
        onImport={vi.fn()}
        onDeleteProfile={onDeleteProfile}
        onDeleteDefinition={vi.fn()}
        onCreateProfile={vi.fn()}
        onUpdateProfile={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '删除 First' }))
    await userEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await act(async () => { await Events.Emit(SETTINGS_PREVIEW_CANCELLED_EVENT, { data: null }) })

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    const secondDelete = screen.getByRole('button', { name: '删除 Second' })
    expect(secondDelete).toBeDisabled()
    await userEvent.click(secondDelete)
    expect(onDeleteProfile).toHaveBeenCalledOnce()

    await act(async () => { deleting.resolve(); await Promise.resolve() })
    await waitFor(() => expect(secondDelete).toBeEnabled())
    await userEvent.click(secondDelete)
    await userEvent.click(screen.getByRole('button', { name: '确认删除' }))
    expect(onDeleteProfile).toHaveBeenCalledTimes(2)
  })

})

const profiles = [profile(1, 'GitHub Dark', 'dark'), profile(2, 'GitHub Light', 'light')]

function profile(...[id, name, mode, builtin = true]: [number, string, string, boolean?]) {
  return {
    id,
    name,
    theme_id: id,
    follow_global_style: true,
    font_family: 'monospace',
    font_size: 14,
    cursor_style: 'bar',
    color_overrides: '{}',
    definition: {
      id,
      name,
      mode,
      source_type: builtin ? 'builtin' : 'import',
      source_license: 'MIT',
      is_builtin: builtin,
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
