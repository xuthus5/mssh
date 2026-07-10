import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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

  it('shows password field by default (auth=password)', () => {
    render(<SessionDialog {...defaultProps} />)
    expect(screen.getByText('密码')).toBeInTheDocument()
  })

  it('shows key ID field when switching to key auth', async () => {
    const user = userEvent.setup()
    render(<SessionDialog {...defaultProps} />)

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: '密钥' }))

    expect(screen.getByText('密钥 ID')).toBeInTheDocument()
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

    await user.click(screen.getByRole('button', { name: '创建' }))

    expect(defaultProps.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'test', host: '10.0.0.1', username: 'root',
      }),
    )
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
})
