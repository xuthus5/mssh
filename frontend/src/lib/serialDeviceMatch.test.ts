import { describe, expect, it } from 'vitest'
import {
  isSerialDeviceActive,
  isSerialDevicePresent,
  normalizeSerialDeviceKey,
} from '@/lib/serialDeviceMatch'

describe('serialDeviceMatch', () => {
  it('normalizes unix-style device paths', () => {
    expect(normalizeSerialDeviceKey('/dev/./ttyUSB0/')).toBe('/dev/ttyUSB0')
    expect(normalizeSerialDeviceKey('  /dev/ttyUSB0  ')).toBe('/dev/ttyUSB0')
    expect(normalizeSerialDeviceKey('/dev/foo/../ttyUSB0')).toBe('/dev/ttyUSB0')
  })

  it('normalizes windows COM names to bare COMx keys', () => {
    expect(normalizeSerialDeviceKey('com3')).toBe('COM3')
    expect(normalizeSerialDeviceKey('\\\\.\\COM3')).toBe('COM3')
  })

  it('matches active map and present list via normalized keys', () => {
    const active = { '/dev/ttyUSB0': 'term-1' }
    expect(isSerialDeviceActive('/dev/./ttyUSB0', active)).toBe(true)
    expect(isSerialDeviceActive('/dev/ttyACM0', active)).toBe(false)
    expect(isSerialDevicePresent('/dev/./ttyUSB0', ['/dev/ttyUSB0', '/dev/ttyACM0'])).toBe(true)
    expect(isSerialDevicePresent('/dev/missing', ['/dev/ttyUSB0'])).toBe(false)
    expect(isSerialDeviceActive('COM3', { '\\\\.\\COM3': 'term-9' })).toBe(true)
  })
})
