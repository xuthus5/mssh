import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceSnapshot, parseWorkspaceSnapshot, restoreWorkspaceSnapshot, type WorkspaceSnapshot } from '@/store/workspacePersistence'

describe('workspace persistence', () => {
  it('persists terminal intent without stale backend identifiers', () => {
    const snapshot = createWorkspaceSnapshot({
      tabs: [{ id: 'terminal-dead', title: 'prod', type: 'terminal', terminalId: 'dead', sessionId: 7, terminalInstance: 2, toolPanel: 'system' }],
      activeSurface: { type: 'terminal', id: 'terminal-dead' }, workspaceTab: 'sessions', overviewSection: 'keys',
    })

    expect(JSON.stringify(snapshot)).not.toContain('dead')
    expect(snapshot).toMatchObject({
      active: { type: 'tab', index: 0 },
      tabs: [{ type: 'terminal', sessionId: 7, toolPanel: 'system' }],
    })
  })

  it('rejects obsolete or malformed layouts instead of maintaining compatibility code', () => {
    expect(() => parseWorkspaceSnapshot('{"version":0,"tabs":[]}')).toThrow('workspace layout is invalid')
    expect(() => parseWorkspaceSnapshot('{"version":2,"tabs":[],"active":null,"workspaceTab":"bad","overviewSection":"sessions"}')).toThrow('workspace layout is invalid')
  })

  it('reconnects valid session intents with new terminal IDs and restores active layout state', async () => {
    const snapshot: WorkspaceSnapshot = {
      version: 2,
      tabs: [
        { type: 'terminal', title: 'prod', sessionId: 7, terminalInstance: 1, toolPanel: 'files' },
        { type: 'terminal', title: 'missing', sessionId: 8, toolPanel: null },
        { type: 'playback', title: 'recording', recordingPath: '/tmp/a.msshlog' },
      ],
      active: { type: 'tab', index: 0 }, workspaceTab: 'macros', overviewSection: 'tunnels',
    }
    const openTerminal = vi.fn(async () => 'fresh-7')

    const restored = await restoreWorkspaceSnapshot(snapshot, new Set([7]), openTerminal)

    expect(openTerminal).toHaveBeenCalledWith(7)
    expect(restored.tabs).toHaveLength(2)
    expect(restored.tabs[0]).toMatchObject({ terminalId: 'fresh-7', toolPanel: 'files' })
    expect(restored.activeSurface).toEqual({ type: 'terminal', id: 'terminal-fresh-7' })
    expect(restored.activePaneId).toBe('fresh-7')
    expect(restored.connectionStatus).toEqual({ 'fresh-7': 'connected' })
    expect(restored.failures).toBe(1)
  })

  it('limits simultaneous reconnects to four workers', async () => {
    let active = 0
    let peak = 0
    const releases: Array<() => void> = []
    const openTerminal = vi.fn(async (sessionID: number) => {
      active++
      peak = Math.max(peak, active)
      await new Promise<void>((resolve) => releases.push(resolve))
      active--
      return `fresh-${sessionID}`
    })
    const snapshot: WorkspaceSnapshot = {
      version: 2,
      tabs: Array.from({ length: 8 }, (_, index) => ({ type: 'terminal' as const, title: `s${index}`, sessionId: index + 1 })),
      active: null, workspaceTab: 'sessions', overviewSection: 'sessions',
    }
    const restoring = restoreWorkspaceSnapshot(snapshot, new Set(Array.from({ length: 8 }, (_, index) => index + 1)), openTerminal)
    await vi.waitFor(() => expect(active).toBe(4))
    while (releases.length > 0) releases.shift()?.()
    await vi.waitFor(() => expect(releases.length).toBe(4))
    while (releases.length > 0) releases.shift()?.()
    await restoring

    expect(peak).toBe(4)
  })
})
