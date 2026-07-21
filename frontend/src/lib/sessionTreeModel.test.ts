import { describe, expect, it } from 'vitest'
import { buildVisibleSessionTreeNodes } from '@/lib/sessionTreeModel'

describe('buildVisibleSessionTreeNodes', () => {
  it('expands only open folders and keeps root sessions', () => {
    const folders = [
      { id: '1', name: 'root', parentId: null, isDefault: true },
      { id: '2', name: 'child', parentId: '1', isDefault: false },
    ]
    const sessions = [
      { id: 's1', name: 'A', folderId: '2' } as never,
      { id: 's2', name: 'B', folderId: null } as never,
    ]
    const collapsed = buildVisibleSessionTreeNodes(folders, sessions as never, new Set())
    expect(collapsed.map((node) => node.id)).toEqual(['folder-1', 'session-s2'])
    const expanded = buildVisibleSessionTreeNodes(folders, sessions as never, new Set(['1', '2']))
    expect(expanded.map((node) => node.id)).toEqual(['folder-1', 'folder-2', 'session-s1', 'session-s2'])
  })
})
