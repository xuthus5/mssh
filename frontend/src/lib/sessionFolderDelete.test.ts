import { describe, expect, it } from 'vitest'
import { remapAfterFolderDelete } from '@/lib/sessionFolderDelete'

describe('remapAfterFolderDelete', () => {
  it('moves child folders and sessions to the default folder from one snapshot', () => {
    const folders = [
      { id: '1', parentId: null, isDefault: true },
      { id: '2', parentId: null, isDefault: false },
      { id: '3', parentId: '2', isDefault: false },
    ]
    const sessions = [
      { folderId: '2' },
      { folderId: '1' },
      { folderId: null },
    ]
    const remapped = remapAfterFolderDelete(folders, sessions, '2')
    expect(remapped.folders).toEqual([
      { id: '1', parentId: null, isDefault: true },
      { id: '3', parentId: '1', isDefault: false },
    ])
    expect(remapped.sessions).toEqual([
      { folderId: '1' },
      { folderId: '1' },
      { folderId: null },
    ])
  })

  it('picks another folder when the deleted folder was default', () => {
    const folders = [
      { id: '1', parentId: null, isDefault: true },
      { id: '2', parentId: null, isDefault: false },
    ]
    const sessions = [{ folderId: '1' }]
    const remapped = remapAfterFolderDelete(folders, sessions, '1')
    expect(remapped.folders).toEqual([{ id: '2', parentId: null, isDefault: false }])
    expect(remapped.sessions).toEqual([{ folderId: '2' }])
  })

  it('nulls remapped ownership when no fallback folder remains', () => {
    const remapped = remapAfterFolderDelete(
      [{ id: '9', parentId: null, isDefault: true }],
      [{ folderId: '9' }],
      '9',
    )
    expect(remapped.folders).toEqual([])
    expect(remapped.sessions).toEqual([{ folderId: null }])
  })

  it('ignores unrelated folders and sessions', () => {
    const remapped = remapAfterFolderDelete(
      [{ id: '1', parentId: null, isDefault: true }, { id: '2', parentId: null }],
      [{ folderId: '1' }],
      '2',
    )
    expect(remapped.folders).toEqual([{ id: '1', parentId: null, isDefault: true }])
    expect(remapped.sessions).toEqual([{ folderId: '1' }])
  })
})
