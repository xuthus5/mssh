import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

const { openFile } = vi.hoisted(() => ({ openFile: vi.fn(async () => ['/tmp/a.itermcolors', '/tmp/b.itermcolors']) }))
vi.mock('@wailsio/runtime', () => ({ Dialogs: { OpenFile: openFile } }))

import { ThemeManager } from '@/components/settings/ThemeManager'

describe('ThemeManager', () => {
  it('imports multiple iTerm2 schemes and shows structured results', async () => {
    const onImport = vi.fn(async () => ({ results: [{ file: '/tmp/a.itermcolors', name: 'A', status: 'imported', definition_id: 3, profile_id: 3, error: '' }, { file: '/tmp/b.itermcolors', name: 'B', status: 'duplicate', definition_id: 4, profile_id: 0, error: '' }] }))
    render(<ThemeManager profiles={profiles as never} onImport={onImport as never} onDeleteProfile={vi.fn()} onDeleteDefinition={vi.fn()} onCreateProfile={vi.fn()} onUpdateProfile={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: '导入 iTerm2 主题' }))
    expect(openFile).toHaveBeenCalledWith(expect.objectContaining({ AllowsMultipleSelection: true, CanChooseDirectories: false }))
    expect(onImport).toHaveBeenCalledWith(['/tmp/a.itermcolors', '/tmp/b.itermcolors'])
    expect(await screen.findByText('已导入')).toBeInTheDocument()
    expect(screen.getByText('已存在')).toBeInTheDocument()
  })

  it('filters themes and protects built-in definitions', async () => {
    render(<ThemeManager profiles={profiles as never} onImport={vi.fn()} onDeleteProfile={vi.fn()} onDeleteDefinition={vi.fn()} onCreateProfile={vi.fn()} onUpdateProfile={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('搜索终端主题'), 'Light')
    expect(screen.getByText('GitHub Light')).toBeInTheDocument()
    expect(screen.queryByText('GitHub Dark')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除 GitHub Light 主题定义' })).toBeDisabled()
  })

  it('renames, copies, and deletes custom profiles', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const update = vi.fn(async () => {})
    const create = vi.fn(async () => {})
    const deleteProfile = vi.fn(async () => {})
    const deleteDefinition = vi.fn(async () => {})
    const custom = { ...profile(3, 'Custom', 'dark'), definition: { ...profile(3, 'Custom', 'dark').definition, is_builtin: false, source_type: 'custom' } }
    render(<ThemeManager profiles={[custom] as never} onImport={vi.fn()} onDeleteProfile={deleteProfile} onDeleteDefinition={deleteDefinition} onCreateProfile={create} onUpdateProfile={update} />)

    await userEvent.click(screen.getByRole('button', { name: '重命名' }))
    await userEvent.clear(screen.getByLabelText('重命名 Custom'))
    await userEvent.type(screen.getByLabelText('重命名 Custom'), 'Renamed')
    await userEvent.click(screen.getByRole('button', { name: '保存名称' }))
    await userEvent.click(screen.getByRole('button', { name: '复制 Custom' }))
    await userEvent.click(screen.getByRole('button', { name: '删除 Custom Profile' }))
    await userEvent.click(screen.getByRole('button', { name: '删除 Custom 主题定义' }))

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ name: 'Renamed' }))
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ id: 0 }))
    expect(deleteProfile).toHaveBeenCalledWith(3)
    expect(deleteDefinition).toHaveBeenCalledWith(3)
  })
})

const profiles = [profile(1, 'GitHub Dark', 'dark'), profile(2, 'GitHub Light', 'light')]
function profile(id: number, name: string, mode: string) { return { id, name, theme_id: id, font_family: 'monospace', font_size: 14, cursor_style: 'bar', color_overrides: '{}', definition: { id, name, mode, source_type: 'builtin', source_license: 'MIT', is_builtin: true } } }
