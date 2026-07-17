import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SessionDialog from '@/components/session/SessionDialog'

describe('SessionDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    session: undefined as undefined | null,
    onSave: vi.fn(),
  }

  beforeEach(() => {
    defaultProps.onOpenChange = vi.fn()
    defaultProps.onSave = vi.fn()
    defaultProps.session = undefined
  })

  it('renders all form fields', () => {
    render(<SessionDialog {...defaultProps} />)
    expect(screen.getByText('新建会话')).toBeInTheDocument()
    expect(screen.getByText('名称')).toBeInTheDocument()
    expect(screen.getByText('主机')).toBeInTheDocument()
    expect(screen.getByText('端口')).toBeInTheDocument()
    expect(screen.getByText('用户名')).toBeInTheDocument()
    expect(screen.getByText('认证方式')).toBeInTheDocument()
  })

  it('groups credentials before asset metadata', () => {
    render(<SessionDialog {...defaultProps} />)

    expect(screen.getByRole('dialog')).toHaveClass('max-h-[calc(100vh-2rem)]', 'overflow-y-auto', 'sm:max-w-lg')
    expect(screen.getByText('连接与认证')).toBeInTheDocument()
    expect(screen.getByText('资产归属')).toBeInTheDocument()
    expect(screen.getByText('终端选项')).toBeInTheDocument()

    const username = screen.getByLabelText('用户名')
    const password = screen.getByLabelText('密码')
    const environment = screen.getByLabelText('环境')
    expect(username.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(password.compareDocumentPosition(environment) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows password field by default (auth=password)', () => {
    render(<SessionDialog {...defaultProps} />)
    expect(screen.getAllByText('密码').length).toBeGreaterThan(0)
  })

  it('shows key ID field when switching to key auth', async () => {
    const user = userEvent.setup()
    render(<SessionDialog {...defaultProps} />)

    const comboboxes = screen.getAllByRole('combobox')
    await user.click(comboboxes[0])
    await user.click(await screen.findByRole('option', { name: '密钥' }))

    expect(screen.getByText('SSH 密钥')).toBeInTheDocument()
  })

  it('fills form with existing session data when editing', () => {
    render(<SessionDialog {...defaultProps} session={{
      id: '1', name: 'prod-db', host: 'db.prod.com', port: 3306,
      username: 'admin', authMethod: 'password', keepAlive: 60,
      termType: 'xterm-256color', folderId: null,
    }} />)
    expect(screen.getByText('编辑会话')).toBeInTheDocument()
    expect(screen.getByDisplayValue('prod-db')).toBeInTheDocument()
    expect(screen.getByDisplayValue('db.prod.com')).toBeInTheDocument()
    expect(screen.getByDisplayValue('3306')).toBeInTheDocument()
    expect(screen.getByDisplayValue('admin')).toBeInTheDocument()
  })

  it('calls onSave with form data when submitted', async () => {
    const user = userEvent.setup()
    render(<SessionDialog {...defaultProps} />)

    const inputs = screen.getAllByRole('textbox')
    // textbox roles: name(0), host(1), username(2), termType(3)
    await user.clear(inputs[0])
    await user.type(inputs[0], 'test')
    await user.clear(inputs[1])
    await user.type(inputs[1], '10.0.0.1')
    await user.clear(inputs[2])
    await user.type(inputs[2], 'root')

    await user.click(screen.getByRole('button', { name: '创建会话' }))

    expect(defaultProps.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'test', host: '10.0.0.1', username: 'root', keepAlive: 0,
      }),
    )
  })

  it('uses the global keep-alive default for new sessions', async () => {
    render(<SessionDialog {...defaultProps} />)

    await waitFor(() => expect(screen.getByRole('spinbutton', { name: '保活间隔 (秒，0 使用全局默认)' })).toHaveValue(0))
  })

  it('explains the keep-alive limitation', async () => {
    const user = userEvent.setup()
    render(<SessionDialog {...defaultProps} />)

    await user.hover(screen.getByRole('button', { name: '会话保活说明' }))

    expect(await screen.findByText('会话保活仅维持底层 SSH 连接，不能控制服务端 Shell 的空闲自动登出策略。')).toBeInTheDocument()
  })

  it('closes dialog when close button clicked', async () => {
    const user = userEvent.setup()
    render(<SessionDialog {...defaultProps} />)

    const closeBtn = document.querySelector('[data-slot="dialog-close"]')
    if (closeBtn) await user.click(closeBtn)

    expect(defaultProps.onOpenChange).toHaveBeenCalled()
  })

  it('renders nothing when open is false', () => {
    render(<SessionDialog {...defaultProps} open={false} />)
    expect(screen.queryByText('新建会话')).not.toBeInTheDocument()
  })

  it('selects the default folder for a new session', async () => {
    const user = userEvent.setup()
    render(<SessionDialog {...defaultProps} folders={[
      { id: '1', name: '默认分组', parentId: null, isDefault: true },
      { id: '2', name: '生产环境', parentId: null, isDefault: false },
    ]} />)
    const inputs = screen.getAllByRole('textbox')
    await user.type(inputs[0], 'server')
    await user.type(inputs[1], '127.0.0.1')
    await user.type(inputs[2], 'root')
    await user.click(screen.getByRole('button', { name: '创建会话' }))
    expect(defaultProps.onSave).toHaveBeenCalledWith(expect.objectContaining({ folderId: '1' }))
  })

  it('shows the selected folder label instead of its ID', () => {
    render(<SessionDialog {...defaultProps} folders={[
      { id: '1', name: '默认分组', parentId: null, isDefault: true },
      { id: '2', name: '生产环境', parentId: null, isDefault: false },
    ]} />)

    const folderSelect = screen.getByRole('combobox', { name: '分组' })
    expect(within(folderSelect).getByText('默认分组（默认）')).toBeInTheDocument()
    expect(within(folderSelect).queryByText('1')).not.toBeInTheDocument()
  })
})
