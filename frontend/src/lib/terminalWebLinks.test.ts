import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openTerminalWebLink } from '@/lib/terminalWebLinks'

const openURL = vi.hoisted(() => vi.fn(async () => undefined))
const toast = vi.hoisted(() => vi.fn())
const loggerError = vi.hoisted(() => vi.fn())

vi.mock('@wailsio/runtime', () => ({ Browser: { OpenURL: openURL } }))
vi.mock('@/components/ui/toast', () => ({ toast }))
vi.mock('@/lib/logger', () => ({ logger: { error: loggerError } }))

function click(uri: string) {
  openTerminalWebLink({} as MouseEvent, uri)
}

describe('openTerminalWebLink', () => {
  beforeEach(() => {
    openURL.mockClear()
    toast.mockClear()
    loggerError.mockClear()
  })

  it('opens a normalized http url in the system browser', async () => {
    click(' https://Example.com/docs?q=1 ')
    expect(openURL).toHaveBeenCalledWith('https://example.com/docs?q=1')
  })

  it('opens an https url', async () => {
    click('https://github.com/xuthus5/mssh')
    expect(openURL).toHaveBeenCalledWith('https://github.com/xuthus5/mssh')
  })

  it('ignores non-http protocols and malformed urls', () => {
    click('javascript:alert(1)')
    click('file:///etc/passwd')
    click('not a url')
    expect(openURL).not.toHaveBeenCalled()
  })

  it('reports failures with a toast and log', async () => {
    const failure = new Error('no browser')
    openURL.mockRejectedValueOnce(failure)
    click('https://example.com')
    await Promise.resolve()
    await Promise.resolve()
    expect(loggerError).toHaveBeenCalledWith('terminal web link open failed', failure)
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('打开链接失败'), 'error')
  })
})
