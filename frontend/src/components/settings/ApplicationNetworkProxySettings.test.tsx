import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApplicationNetworkProxySettingsSection } from '@/components/settings/ApplicationNetworkProxySettings'

describe('ApplicationNetworkProxySettingsSection', () => {
  it('shows manual fields and edits proxy URL', async () => {
    const onProxyURLChange = vi.fn()
    const user = userEvent.setup()
    render(
      <ApplicationNetworkProxySettingsSection
        proxyMode="manual"
        proxyURL="http://127.0.0.1:1080"
        proxyNoProxy="localhost"
        proxyUsername=""
        proxyPassword=""
        onProxyModeChange={vi.fn()}
        onProxyURLChange={onProxyURLChange}
        onProxyNoProxyChange={vi.fn()}
        onProxyUsernameChange={vi.fn()}
        onProxyPasswordChange={vi.fn()}
      />,
    )
    expect(screen.getByText('网络代理')).toBeInTheDocument()
    const input = screen.getByLabelText('代理地址')
    await user.clear(input)
    await user.type(input, 'http://127.0.0.1:7890')
    expect(onProxyURLChange).toHaveBeenCalled()
  })

  it('hides manual fields for system mode', () => {
    render(
      <ApplicationNetworkProxySettingsSection
        proxyMode="system"
        proxyURL=""
        proxyNoProxy=""
        proxyUsername=""
        proxyPassword=""
        onProxyModeChange={vi.fn()}
        onProxyURLChange={vi.fn()}
        onProxyNoProxyChange={vi.fn()}
        onProxyUsernameChange={vi.fn()}
        onProxyPasswordChange={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText('代理地址')).not.toBeInTheDocument()
    expect(screen.getByText(/HTTP\(S\)_PROXY/)).toBeInTheDocument()
  })
})

  it('shows clear control for saved proxy password', async () => {
    const onClear = vi.fn()
    const user = userEvent.setup()
    render(
      <ApplicationNetworkProxySettingsSection
        proxyMode="manual"
        proxyURL="http://127.0.0.1:1080"
        proxyNoProxy=""
        proxyUsername=""
        proxyPassword=""
        proxyPasswordSaved
        clearProxyPassword={false}
        onProxyModeChange={vi.fn()}
        onProxyURLChange={vi.fn()}
        onProxyNoProxyChange={vi.fn()}
        onProxyUsernameChange={vi.fn()}
        onProxyPasswordChange={vi.fn()}
        onClearProxyPasswordChange={onClear}
      />,
    )
    expect(screen.getByPlaceholderText('已安全保存，留空保持不变')).toBeInTheDocument()
    await user.click(screen.getByTestId('clear-proxy-password'))
    expect(onClear).toHaveBeenCalledWith(true)
  })

