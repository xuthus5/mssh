import { describe, expect, it, vi } from 'vitest'
import {
  createWorkspaceSnapshot,
  parseWorkspaceSnapshot,
  restoreWorkspaceSnapshot,
  type OpenTerminalIntent,
  type WorkspaceSnapshot,
} from '@/store/workspacePersistence'

describe('workspace persistence', () => {
  it('persists terminal intent without stale backend identifiers', () => {
    const snapshot = createWorkspaceSnapshot({
      tabs: [{
        id: 'terminal-dead',
        title: 'prod',
        type: 'terminal',
        terminalId: 'dead',
        sessionId: 7,
        terminalInstance: 2,
        toolPanel: 'system',
      }],
      activeSurface: { type: 'terminal', id: 'terminal-dead' },
      workspaceTab: 'sessions',
      overviewSection: 'keys',
    })

    expect(JSON.stringify(snapshot)).not.toContain('dead')
    expect(snapshot).toMatchObject({
      active: { type: 'tab', index: 0 },
      tabs: [{ type: 'terminal', sessionId: 7, toolPanel: 'system' }],
    })
  })

  it('persists local and serial connection kinds for restore', () => {
    const snapshot = createWorkspaceSnapshot({
      tabs: [
        {
          id: 'terminal-local',
          title: '本地终端',
          type: 'terminal',
          terminalId: 'local-1',
          sessionId: 0,
          connectionKind: 'local',
          toolPanel: 'history',
        },
        {
          id: 'terminal-serial',
          title: 'COM1',
          type: 'terminal',
          terminalId: 'serial-1',
          sessionId: 0,
          connectionKind: 'serial',
          serialPortId: 12,
        },
      ],
      activeSurface: { type: 'terminal', id: 'terminal-local' },
      workspaceTab: 'sessions',
      overviewSection: 'serial',
    })
    expect(snapshot.tabs).toEqual([
      expect.objectContaining({ connectionKind: 'local', sessionId: 0, toolPanel: 'history' }),
      expect.objectContaining({ connectionKind: 'serial', serialPortId: 12, sessionId: 0 }),
    ])
    expect(parseWorkspaceSnapshot(JSON.stringify(snapshot)).tabs).toHaveLength(2)
  })

  it('migrates version 2 snapshots into version 3', () => {
    const migrated = parseWorkspaceSnapshot(JSON.stringify({
      version: 2,
      tabs: [{ type: 'terminal', title: 'prod', sessionId: 7, toolPanel: 'files' }],
      active: { type: 'tab', index: 0 },
      workspaceTab: 'sessions',
      overviewSection: 'sessions',
    }))
    expect(migrated.version).toBe(3)
    expect(migrated.tabs).toHaveLength(1)
  })

  it('rejects obsolete or malformed layouts instead of maintaining compatibility code', () => {
    expect(() => parseWorkspaceSnapshot('{"version":0,"tabs":[]}')).toThrow('workspace layout is invalid')
    expect(() => parseWorkspaceSnapshot('{"version":3,"tabs":[],"active":null,"workspaceTab":"bad","overviewSection":"sessions"}')).toThrow('workspace layout is invalid')
  })

  it('reconnects valid session intents with new terminal IDs and restores active layout state', async () => {
    const snapshot: WorkspaceSnapshot = {
      version: 3,
      tabs: [
        { type: 'terminal', title: 'prod', sessionId: 7, terminalInstance: 1, toolPanel: 'files' },
        { type: 'terminal', title: 'missing', sessionId: 8, toolPanel: null },
        { type: 'playback', title: 'recording', recordingPath: '/tmp/a.msshlog' },
      ],
      active: { type: 'tab', index: 0 },
      workspaceTab: 'macros',
      overviewSection: 'tunnels',
    }
    const openTerminal = vi.fn(async () => 'fresh-7')

    const restored = await restoreWorkspaceSnapshot(snapshot, new Set([7]), openTerminal)

    expect(openTerminal).toHaveBeenCalledWith(expect.objectContaining({
      connectionKind: 'ssh',
      sessionId: 7,
    }))
    expect(restored.tabs).toHaveLength(2)
    expect(restored.tabs[0]).toMatchObject({ terminalId: 'fresh-7', toolPanel: 'files' })
    expect(restored.activeSurface).toEqual({ type: 'terminal', id: 'terminal-fresh-7' })
    expect(restored.activePaneId).toBe('fresh-7')
    expect(restored.connectionStatus).toEqual({ 'fresh-7': 'connected' })
    expect(restored.failures).toBe(1)
  })

  it('restores local and serial tabs through the kind-aware opener', async () => {
    const snapshot: WorkspaceSnapshot = {
      version: 3,
      tabs: [
        { type: 'terminal', title: '本地终端', sessionId: 0, connectionKind: 'local' },
        { type: 'terminal', title: 'COM1', sessionId: 0, connectionKind: 'serial', serialPortId: 9 },
      ],
      active: { type: 'tab', index: 0 },
      workspaceTab: 'sessions',
      overviewSection: 'serial',
    }
    const openTerminal = vi.fn(async (intent: OpenTerminalIntent) => {
      if (intent.connectionKind === 'local') return 'local-fresh'
      return 'serial-fresh'
    })
    const restored = await restoreWorkspaceSnapshot(snapshot, new Set(), openTerminal, new Set([9]))
    expect(openTerminal).toHaveBeenCalledWith(expect.objectContaining({ connectionKind: 'local' }))
    expect(openTerminal).toHaveBeenCalledWith(expect.objectContaining({ connectionKind: 'serial', serialPortId: 9 }))
    expect(restored.tabs).toEqual([
      expect.objectContaining({ terminalId: 'local-fresh', connectionKind: 'local' }),
      expect.objectContaining({ terminalId: 'serial-fresh', connectionKind: 'serial', serialPortId: 9 }),
    ])
  })

  it('persists ssh/local split layout roles without terminal ids', () => {
    const snapshot = createWorkspaceSnapshot({
      tabs: [{
        id: 'terminal-a',
        title: 'prod',
        type: 'terminal',
        terminalId: 't1',
        sessionId: 3,
        splitLayout: {
          paneCount: 2,
          tree: { kind: 'branch', direction: 'horizontal', ratio: 40, first: { kind: 'leaf', role: 0 }, second: { kind: 'leaf', role: 1 } },
        },
      }],
      activeSurface: { type: 'terminal', id: 'terminal-a' },
      workspaceTab: 'sessions',
      overviewSection: 'sessions',
    })
    expect(snapshot.version).toBe(3)
    expect(snapshot.tabs[0]).toMatchObject({ splitLayout: { paneCount: 2 } })
    expect(JSON.stringify(snapshot)).not.toContain('t1')
    expect(parseWorkspaceSnapshot(JSON.stringify(snapshot)).tabs[0]).toMatchObject({
      type: 'terminal',
      splitLayout: { paneCount: 2 },
    })
  })

  it('rejects serial tabs that claim multi-pane split layouts', () => {
    expect(() => parseWorkspaceSnapshot(JSON.stringify({
      version: 3,
      tabs: [{
        type: 'terminal',
        title: 'COM',
        sessionId: 0,
        connectionKind: 'serial',
        serialPortId: 1,
        splitLayout: {
          paneCount: 2,
          tree: { kind: 'branch', direction: 'horizontal', ratio: 50, first: { kind: 'leaf', role: 0 }, second: { kind: 'leaf', role: 1 } },
        },
      }],
      active: null,
      workspaceTab: 'sessions',
      overviewSection: 'serial',
    }))).toThrow('workspace layout is invalid')
  })

  it('limits simultaneous reconnects to four workers', async () => {
    let active = 0
    let peak = 0
    const releases: Array<() => void> = []
    const openTerminal = vi.fn(async (intent: OpenTerminalIntent) => {
      active++
      peak = Math.max(peak, active)
      await new Promise<void>((resolve) => releases.push(resolve))
      active--
      return `fresh-${intent.sessionId}`
    })
    const snapshot: WorkspaceSnapshot = {
      version: 3,
      tabs: Array.from({ length: 8 }, (_, index) => ({ type: 'terminal' as const, title: `s${index}`, sessionId: index + 1 })),
      active: null,
      workspaceTab: 'sessions',
      overviewSection: 'sessions',
    }
    const restoring = restoreWorkspaceSnapshot(
      snapshot,
      new Set(Array.from({ length: 8 }, (_, index) => index + 1)),
      openTerminal,
    )
    await vi.waitFor(() => expect(active).toBe(4))
    while (releases.length > 0) releases.shift()?.()
    await vi.waitFor(() => expect(releases.length).toBe(4))
    while (releases.length > 0) releases.shift()?.()
    await restoring

    expect(peak).toBe(4)
  })
})
