import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContainerPanel } from '@/components/terminal/container/ContainerPanel'
import { ContainerCreateDialog } from '@/components/terminal/container/ContainerCreateDialog'

const terminalService = vi.hoisted(() => ({
  ContainerOverview: vi.fn(),
  ContainerAction: vi.fn(),
  ContainerRunCommand: vi.fn(),
  CreateContainer: vi.fn(),
}))
const clipboard = vi.hoisted(() => ({ writeText: vi.fn() }))
const toast = vi.hoisted(() => vi.fn())
const requestConfirm = vi.hoisted(() => vi.fn())

vi.mock('@/lib/wails', () => ({ TerminalService: terminalService }))
vi.mock('@/lib/clipboard', () => ({ getClipboard: () => clipboard }))
vi.mock('@/components/ui/toast', () => ({ toast }))
vi.mock('@/lib/confirmDialog', () => ({ requestConfirm }))

const overview = {
  engines: [
    { name: 'docker', version: '24.0.7', available: true, error: '' },
    { name: 'containerd', version: '1.7.0', available: true, error: '' },
    { name: 'podman', version: '', available: false, error: 'Podman unavailable' },
  ],
  containers: [
    { id: 'abc123', name: 'web', engine: 'docker', namespace: '', image: 'nginx:latest', state: 'running', status: 'Up 2 hours', ports: '8080:80' },
    { id: 'ctr-1', name: 'job', engine: 'containerd', namespace: 'default', image: 'busybox', state: 'stopped', status: 'STOPPED', ports: '' },
  ],
}

describe('ContainerPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    terminalService.ContainerOverview.mockResolvedValue(overview)
    terminalService.ContainerAction.mockResolvedValue(undefined)
    terminalService.ContainerRunCommand.mockResolvedValue("docker run -d --name web nginx:latest")
    terminalService.CreateContainer.mockResolvedValue(undefined)
    clipboard.writeText.mockResolvedValue(undefined)
    toast.mockReturnValue(undefined)
    requestConfirm.mockResolvedValue(true)
  })

  it('loads and filters detected engine containers', async () => {
    const user = userEvent.setup()
    render(<ContainerPanel terminalID="term-1" active />)
    expect(await screen.findByText('web')).toBeInTheDocument()
    expect(terminalService.ContainerOverview).toHaveBeenCalledWith('term-1')
    expect(screen.getByText('docker 24.0.7')).toBeInTheDocument()
    expect(screen.getByText('podman · 不可用')).toHaveAttribute('title', 'Podman unavailable')

    await user.type(screen.getByLabelText('搜索容器名称、镜像或 ID'), 'busybox')
    expect(screen.getByText('job')).toBeInTheDocument()
    expect(screen.queryByText('web')).not.toBeInTheDocument()
  })

  it('copies a reconstructed run command', async () => {
    const user = userEvent.setup()
    render(<ContainerPanel terminalID="term-1" active />)
    await screen.findByText('web')
    await user.click(screen.getAllByRole('button', { name: '复制运行命令' })[0])
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('docker run -d --name web nginx:latest'))
    expect(terminalService.ContainerRunCommand).toHaveBeenCalledWith('term-1', 'docker', '', 'abc123')
    expect(toast).toHaveBeenCalledWith('运行命令已复制', 'success')
  })

  it('reports failures when copying a run command', async () => {
    const user = userEvent.setup()
    terminalService.ContainerRunCommand.mockRejectedValueOnce(new Error('inspect failed'))
    render(<ContainerPanel terminalID="term-1" active />)
    await screen.findByText('web')
    await user.click(screen.getAllByRole('button', { name: '复制运行命令' })[0])
    await waitFor(() => expect(toast).toHaveBeenCalledWith('复制运行命令失败: inspect failed', 'error'))
    expect(clipboard.writeText).not.toHaveBeenCalled()
  })

  it('rejects an empty reconstructed run command', async () => {
    const user = userEvent.setup()
    terminalService.ContainerRunCommand.mockResolvedValueOnce('   ')
    render(<ContainerPanel terminalID="term-1" active />)
    await screen.findByText('web')
    await user.click(screen.getAllByRole('button', { name: '复制运行命令' })[0])
    await waitFor(() => expect(toast).toHaveBeenCalledWith('复制运行命令失败: 运行命令为空', 'error'))
    expect(clipboard.writeText).not.toHaveBeenCalled()
  })

  it('starts stopped containers and refreshes the overview', async () => {
    const user = userEvent.setup()
    render(<ContainerPanel terminalID="term-1" active />)
    await screen.findByText('job')
    const start = screen.getByRole('button', { name: '启动' })
    await user.click(start)
    await waitFor(() => expect(terminalService.ContainerAction).toHaveBeenCalledWith('term-1', expect.objectContaining({
      engine: 'containerd', namespace: 'default', id: 'ctr-1', action: 'start',
    })))
    expect(terminalService.ContainerOverview.mock.calls.length).toBeGreaterThan(1)
  })

  it('reports lifecycle action failures', async () => {
    const user = userEvent.setup()
    terminalService.ContainerAction.mockRejectedValueOnce(new Error('engine unavailable'))
    render(<ContainerPanel terminalID="term-1" active />)
    await screen.findByText('web')
    await user.click(screen.getAllByRole('button', { name: '重启' })[0])
    await waitFor(() => expect(toast).toHaveBeenCalledWith('容器操作失败: engine unavailable', 'error'))
  })

  it('confirms before removing a container', async () => {
    const user = userEvent.setup()
    render(<ContainerPanel terminalID="term-1" active />)
    await screen.findByText('web')
    await user.click(screen.getAllByRole('button', { name: '删除容器' })[0])
    expect(requestConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: '删除容器？', destructive: true }))
    await waitFor(() => expect(terminalService.ContainerAction).toHaveBeenCalledWith('term-1', expect.objectContaining({ engine: 'docker', id: 'abc123', action: 'remove' })))
  })

  it('does not remove when confirmation is cancelled', async () => {
    const user = userEvent.setup()
    requestConfirm.mockResolvedValueOnce(false)
    render(<ContainerPanel terminalID="term-1" active />)
    await screen.findByText('web')
    await user.click(screen.getAllByRole('button', { name: '删除容器' })[0])
    await waitFor(() => expect(requestConfirm).toHaveBeenCalled())
    expect(terminalService.ContainerAction).not.toHaveBeenCalled()
  })

  it('shows collection failures and retries', async () => {
    const user = userEvent.setup()
    terminalService.ContainerOverview.mockRejectedValueOnce(new Error('probe failed')).mockResolvedValueOnce(overview)
    render(<ContainerPanel terminalID="term-1" active />)
    expect(await screen.findByRole('alert')).toHaveTextContent('容器信息采集失败')
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('web')).toBeInTheDocument()
  })

  it('reports empty engines without opening the create flow', async () => {
    terminalService.ContainerOverview.mockResolvedValue({ engines: [], containers: [] })
    render(<ContainerPanel terminalID="term-empty" active />)
    expect(await screen.findByText('没有检测到可用的容器引擎')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新建容器' })).toBeDisabled()
  })

  it('creates a container from the dialog', async () => {
    const user = userEvent.setup()
    render(<ContainerPanel terminalID="term-1" active />)
    await screen.findByText('web')
    await user.click(screen.getByRole('button', { name: '新建容器' }))
    await user.type(await screen.findByLabelText('容器名称'), 'worker')
    await user.type(screen.getByLabelText('镜像名称'), 'busybox:latest')
    await user.type(screen.getByLabelText('启动参数（每行一个）'), 'sh\necho ok')
    await user.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => expect(terminalService.CreateContainer).toHaveBeenCalledWith('term-1', expect.objectContaining({
      engine: 'docker', image: 'busybox:latest', name: 'worker', command: ['sh', 'echo ok'],
    })))
  })
})

describe('ContainerCreateDialog containerd mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    terminalService.CreateContainer.mockResolvedValue(undefined)
    toast.mockReturnValue(undefined)
  })

  it('collects containerd namespace, env and mounts', async () => {
    const user = userEvent.setup()
    const onCreated = vi.fn()
    render(<ContainerCreateDialog open={true} onOpenChange={vi.fn()} onCreated={onCreated} terminalID="term-1" engines={[overview.engines[1]]} />)
    await waitFor(() => expect(screen.getByText('containerd 1.7.0')).toBeInTheDocument())
    await user.type(screen.getByLabelText('容器名称'), 'job')
    await user.type(screen.getByLabelText('镜像名称'), 'busybox')
    await user.clear(screen.getByLabelText('containerd 命名空间'))
    await user.type(screen.getByLabelText('containerd 命名空间'), 'k8s.io')
    await user.type(screen.getByLabelText('环境变量（每行一个，KEY=VALUE）'), 'A=1')
    await user.type(screen.getByLabelText('挂载（每行一个）'), 'type=bind,src=/tmp,dst=/data')
    expect(screen.queryByLabelText('重启策略')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => expect(terminalService.CreateContainer).toHaveBeenCalledWith('term-1', expect.objectContaining({
      engine: 'containerd', namespace: 'k8s.io', env: ['A=1'], volumes: ['type=bind,src=/tmp,dst=/data'], ports: [], restart_policy: '',
    })))
    expect(onCreated).toHaveBeenCalled()
  })

  it('reports creation failures and keeps the dialog open', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    terminalService.CreateContainer.mockRejectedValueOnce(new Error('image not found'))
    render(<ContainerCreateDialog open={true} onOpenChange={onOpenChange} onCreated={vi.fn()} terminalID="term-1" engines={[overview.engines[1]]} />)
    await user.type(await screen.findByLabelText('容器名称'), 'job')
    await user.type(screen.getByLabelText('镜像名称'), 'busybox')
    await user.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('创建容器失败: image not found', 'error'))
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
