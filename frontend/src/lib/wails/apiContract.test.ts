import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AboutService, AIService, AssetCatalogService, AuditService, CommandHistoryService, FileService, FontService,
  KeyService, LogService, MacroService, SecurityService, SerialService, SessionService, SettingService,
  SyncService, TerminalService, ThemeService, TunnelService,
} from '@/lib/wails'
import { __clearHandlers, __registerHandler } from '@/test/__mocks__/wails-runtime'

type ServiceModule = Record<string, unknown>

const services: Record<string, ServiceModule> = {
  AboutService, AIService, AssetCatalogService, AuditService, CommandHistoryService, FileService, FontService,
  KeyService, LogService, MacroService, SecurityService, SerialService, SessionService, SettingService,
  SyncService, TerminalService, ThemeService, TunnelService,
}
const generatedModules = import.meta.glob(
  '../../../bindings/github.com/xuthus5/mssh/internal/service/*service.ts',
  { eager: true },
) as Record<string, ServiceModule>
const productionSources = import.meta.glob('../../**/*.{ts,tsx}', {
  eager: true, query: '?raw', import: 'default',
}) as Record<string, string>
const serviceCallPattern = /([A-Z][A-Za-z0-9]*Service)[.]([A-Z][A-Za-z0-9_]*)[ \t\r\n]*[(]/g
const serviceFQNPrefix = 'github.com/xuthus5/mssh/internal/service.'

describe('Wails frontend API contract', () => {
  beforeEach(() => __clearHandlers())

  it('exports every generated service through the typed barrel', () => {
    const generatedNames = Object.values(generatedModules).map(barrelServiceName).sort()
    expect(Object.keys(services).sort()).toEqual(generatedNames)
    for (const generated of Object.values(generatedModules)) {
      expect(Object.keys(services[barrelServiceName(generated)]).sort()).toEqual(Object.keys(generated).sort())
    }
  })

  for (const [serviceName, service] of Object.entries(services)) {
    for (const [methodName, value] of Object.entries(service)) {
      if (typeof value !== 'function') continue
      it(`forwards ${serviceName}.${methodName} arguments to its exact backend method`, async () => {
        const handler = vi.fn(async () => undefined)
        const args = Array.from({ length: value.length }, (_, index) => `argument-${index}`)
        __registerHandler(`${serviceFQNPrefix}${serviceName}.${methodName}`, handler)

        await (value as (...input: unknown[]) => Promise<unknown>)(...args)

        expect(handler).toHaveBeenCalledOnce()
        expect(handler).toHaveBeenCalledWith(...args)
      })
    }
  }

  it('resolves every production service call to a tested generated binding', () => {
    const unresolved: string[] = []
    const calls = new Set<string>()
    for (const [path, source] of Object.entries(productionSources)) {
      if (isTestSource(path)) continue
      for (const match of source.matchAll(serviceCallPattern)) {
        const [, serviceName, methodName] = match
        calls.add(`${serviceName}.${methodName}`)
        if (typeof services[serviceName]?.[methodName] !== 'function') {
          unresolved.push(`${path}: ${serviceName}.${methodName}`)
        }
      }
    }
    expect(calls.size).toBeGreaterThan(100)
    expect(unresolved).toEqual([])
  })
})

function barrelServiceName(generated: ServiceModule): string {
  const match = Object.entries(services).find(([, service]) => service === generated)
  if (!match) throw new Error('generated Wails service is missing from the frontend barrel')
  return match[0]
}

function isTestSource(path: string): boolean {
  return path.includes('.test.') || path.includes('/test/') || path.includes('/__tests__/')
}
