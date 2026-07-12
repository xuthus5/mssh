import { describe, expect, it } from 'vitest'
import { connectionStatusVisual } from '@/lib/connectionStatusVisual'

describe('connectionStatusVisual', () => {
  it('uses a prominent green indicator for connected sessions', () => {
    expect(connectionStatusVisual('connected')).toMatchObject({ label: '已连接', dotClass: expect.stringContaining('text-emerald-500') })
  })

  it('assigns distinct visual semantics to other states', () => {
    expect(connectionStatusVisual('connecting').dotClass).toContain('text-amber-500')
    expect(connectionStatusVisual('connecting').dotClass).toContain('motion-safe:animate-pulse')
    expect(connectionStatusVisual('disconnected').dotClass).toContain('text-destructive')
    expect(connectionStatusVisual(undefined)).toMatchObject({ label: '就绪', dotClass: expect.stringContaining('text-muted-foreground') })
  })
})
