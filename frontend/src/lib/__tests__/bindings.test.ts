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

// Map of service name → expected minimum exported functions
const EXPECTED_METHODS: Record<string, string[]> = {
  SessionService: ['Connect', 'CreateFolder', 'CreateSession', 'DeleteFolder', 'DeleteSession', 'Disconnect', 'GetSession', 'ListFolders', 'ListSessions'],
  TerminalService: ['Close', 'Open', 'Resize', 'Write'],
  FileService: ['ListDir', 'Upload', 'Download', 'CancelTransfer', 'Delete', 'Mkdir', 'Rename'],
  KeyService: ['List', 'Generate', 'Import', 'Delete', 'ExportPublicKey'],
  SettingService: ['GetSetting', 'SetSetting'],
  TunnelService: ['List', 'Create', 'Update', 'Delete', 'Start', 'Stop'],
  MacroService: ['List', 'Create', 'Update', 'Delete', 'Execute'],
  ThemeService: ['List', 'Create', 'Update', 'Delete', 'GetActive', 'SetActive'],
  LogService: ['List', 'StartRecording', 'StopRecording', 'GetRecording', 'Delete'],
  SyncService: ['Export', 'Import'],
}

describe('Generated Bindings', () => {
  const services: [string, Record<string, unknown>, string[]][] = [
    ['SessionService', SessionService as unknown as Record<string, unknown>, EXPECTED_METHODS.SessionService],
    ['TerminalService', TerminalService as unknown as Record<string, unknown>, EXPECTED_METHODS.TerminalService],
    ['FileService', FileService as unknown as Record<string, unknown>, EXPECTED_METHODS.FileService],
    ['KeyService', KeyService as unknown as Record<string, unknown>, EXPECTED_METHODS.KeyService],
    ['SettingService', SettingService as unknown as Record<string, unknown>, EXPECTED_METHODS.SettingService],
    ['TunnelService', TunnelService as unknown as Record<string, unknown>, EXPECTED_METHODS.TunnelService],
    ['MacroService', MacroService as unknown as Record<string, unknown>, EXPECTED_METHODS.MacroService],
    ['ThemeService', ThemeService as unknown as Record<string, unknown>, EXPECTED_METHODS.ThemeService],
    ['LogService', LogService as unknown as Record<string, unknown>, EXPECTED_METHODS.LogService],
    ['SyncService', SyncService as unknown as Record<string, unknown>, EXPECTED_METHODS.SyncService],
  ]

  for (const [name, svc, expectedMethods] of services) {
    it(`${name} exports all expected methods`, () => {
      expect(svc).toBeDefined()
      for (const method of expectedMethods) {
        expect(typeof svc[method]).toBe('function')
      }
    })

    it(`${name} has no missing methods`, () => {
      const actualKeys = Object.keys(svc)
      // Filter out symbols and internal helpers
      const methods = actualKeys.filter((k) => typeof svc[k] === 'function')
      // Every expected method must be present
      for (const m of expectedMethods) {
        expect(methods).toContain(m)
      }
    })
  }

  it('all 10 services are exported from barrel', () => {
    expect(typeof SessionService.ListFolders).toBe('function')
    expect(typeof TerminalService.Open).toBe('function')
    expect(typeof FileService.ListDir).toBe('function')
    expect(typeof KeyService.List).toBe('function')
    expect(typeof SettingService.GetSetting).toBe('function')
    expect(typeof TunnelService.List).toBe('function')
    expect(typeof MacroService.List).toBe('function')
    expect(typeof ThemeService.List).toBe('function')
    expect(typeof LogService.List).toBe('function')
    expect(typeof SyncService.Export).toBe('function')
  })
})
