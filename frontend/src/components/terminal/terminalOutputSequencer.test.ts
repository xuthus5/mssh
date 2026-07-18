import { describe, expect, it, vi } from 'vitest'
import { TerminalOutputSequencer } from '@/components/terminal/terminalOutputSequencer'

describe('TerminalOutputSequencer', () => {
  it('releases output in sequence order', () => {
    const write = vi.fn()
    const sequencer = new TerminalOutputSequencer(write)

    sequencer.push(2, new Uint8Array([0x32]))
    sequencer.push(1, new Uint8Array([0x31]))
    sequencer.push(3, new Uint8Array([0x33]))

    expect(write.mock.calls.map(([data]) => Array.from(data))).toEqual([[0x31], [0x32], [0x33]])
  })

  it('ignores already delivered and duplicate pending output', () => {
    const write = vi.fn()
    const sequencer = new TerminalOutputSequencer(write)

    sequencer.push(2, new Uint8Array([0x32]))
    sequencer.push(2, new Uint8Array([0xff]))
    sequencer.push(1, new Uint8Array([0x31]))
    sequencer.push(1, new Uint8Array([0xff]))

    expect(write.mock.calls.map(([data]) => Array.from(data))).toEqual([[0x31], [0x32]])
  })

  it('rejects an excessive sequence gap', () => {
    const sequencer = new TerminalOutputSequencer(vi.fn(), { maxPendingChunks: 2 })

    sequencer.push(3, new Uint8Array([0x33]))
    sequencer.push(2, new Uint8Array([0x32]))

    expect(() => sequencer.push(4, new Uint8Array([0x34]))).toThrow('terminal output sequence gap exceeded 2 chunks')
  })

  it('rejects invalid sequence values', () => {
    const sequencer = new TerminalOutputSequencer(vi.fn())

    expect(() => sequencer.push(0, new Uint8Array([0x30]))).toThrow('invalid terminal output sequence: 0')
    expect(() => sequencer.push(Number.MAX_SAFE_INTEGER + 1, new Uint8Array([0x31]))).toThrow('invalid terminal output sequence')
  })
})
