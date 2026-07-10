import { describe, it, expect } from 'vitest'
import {
  SessionService,
  TerminalService,
  FileService,
  KeyService,
  SettingService,
  TunnelService,
  MacroService,
  ThemeService,
  LogService,
  SyncService,
} from '@/lib/wails'

describe('Generated Bindings Barrel', () => {
  it('exports SessionService', () => {
    expect(SessionService).toBeDefined()
    expect(typeof SessionService.ListFolders).toBe('function')
    expect(typeof SessionService.CreateSession).toBe('function')
    expect(typeof SessionService.Connect).toBe('function')
  })

  it('exports TerminalService', () => {
    expect(TerminalService).toBeDefined()
    expect(typeof TerminalService.Open).toBe('function')
    expect(typeof TerminalService.Write).toBe('function')
  })

  it('exports FileService', () => {
    expect(FileService).toBeDefined()
    expect(typeof FileService.ListDir).toBe('function')
    expect(typeof FileService.Upload).toBe('function')
  })

  it('exports KeyService', () => {
    expect(KeyService).toBeDefined()
    expect(typeof KeyService.List).toBe('function')
    expect(typeof KeyService.Generate).toBe('function')
  })

  it('exports SettingService', () => {
    expect(SettingService).toBeDefined()
    expect(typeof SettingService.GetSetting).toBe('function')
  })

  it('exports TunnelService', () => {
    expect(TunnelService).toBeDefined()
    expect(typeof TunnelService.List).toBe('function')
  })

  it('exports MacroService', () => {
    expect(MacroService).toBeDefined()
    expect(typeof MacroService.List).toBe('function')
  })

  it('exports ThemeService', () => {
    expect(ThemeService).toBeDefined()
    expect(typeof ThemeService.List).toBe('function')
  })

  it('exports LogService', () => {
    expect(LogService).toBeDefined()
    expect(typeof LogService.List).toBe('function')
  })

  it('exports SyncService', () => {
    expect(SyncService).toBeDefined()
    expect(typeof SyncService.Export).toBe('function')
  })
})
