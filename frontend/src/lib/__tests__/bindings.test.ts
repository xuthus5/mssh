import { describe, it, expect } from 'vitest'
import {
  SessionService,
  TerminalService,
  FileService,
  KeyService,
  SettingService,
  AuditService,
  AIService,
  TunnelService,
  MacroService,
  ThemeService,
  LogService,
  SyncService,
  AboutService,
  FontService,
} from '@/lib/wails'

describe('Generated Bindings Barrel', () => {
  it('exports SessionService', () => {
    expect(SessionService).toBeDefined()
    expect(typeof SessionService.ListFolders).toBe('function')
    expect(typeof SessionService.CreateSession).toBe('function')
    expect('Connect' in SessionService).toBe(false)
    expect('Disconnect' in SessionService).toBe(false)
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
    expect(typeof SettingService.Get).toBe('function')
    expect(typeof SettingService.Set).toBe('function')
    expect('GetSetting' in SettingService).toBe(false)
    expect('SetSetting' in SettingService).toBe(false)
  })

  it('exports AuditService', () => {
    expect(AuditService).toBeDefined()
    expect(typeof AuditService.List).toBe('function')
    expect(typeof AuditService.SetEnabled).toBe('function')
  })

  it('exports AIService', () => {
    expect(AIService).toBeDefined()
    expect(typeof AIService.Dashboard).toBe('function')
    expect(typeof AIService.Chat).toBe('function')
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
    expect(typeof ThemeService.ListProfiles).toBe('function')
  })

  it('exports LogService', () => {
    expect(LogService).toBeDefined()
    expect(typeof LogService.List).toBe('function')
    expect(typeof LogService.StartTerminalRecording).toBe('function')
    expect('StartRecording' in LogService).toBe(false)
    expect('StopRecording' in LogService).toBe(false)
    expect('CloseAllActiveRecordings' in LogService).toBe(false)
  })

  it('exports SyncService', () => {
    expect(SyncService).toBeDefined()
    expect(typeof SyncService.Export).toBe('function')
  })

  it('exports AboutService', () => {
    expect(AboutService).toBeDefined()
    expect(typeof AboutService.CheckUpdate).toBe('function')
  })

  it('exports FontService', () => {
    expect(FontService).toBeDefined()
    expect(typeof FontService.List).toBe('function')
  })

})
