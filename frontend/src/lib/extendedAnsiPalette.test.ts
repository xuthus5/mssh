import { describe, expect, it } from 'vitest'
import { buildExtendedAnsiPalette } from '@/lib/extendedAnsiPalette'

const STANDARD_ANSI = [
  '#000000', '#cd0000', '#00cd00', '#cdcd00',
  '#0000ee', '#cd00cd', '#00cdcd', '#e5e5e5',
  '#7f7f7f', '#ff0000', '#00ff00', '#ffff00',
  '#5c5cff', '#ff00ff', '#00ffff', '#ffffff',
]

const DRACULA_ANSI = [
  '#21222c', '#ff5555', '#50fa7b', '#f1fa8c',
  '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2',
  '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5',
  '#d6acff', '#ff92df', '#a4ffff', '#ffffff',
]

describe('buildExtendedAnsiPalette', () => {
  it('builds the standard xterm color cube and grayscale ramp', () => {
    const palette = buildExtendedAnsiPalette(STANDARD_ANSI)

    expect(palette).toHaveLength(240)
    expect(palette[0]).toBe('#000000')
    expect(palette[180]).toBe('#ff0000')
    expect(palette[216]).toBe('#080808')
    expect(palette[239]).toBe('#eeeeee')
  })

  it('uses the active theme as the extended palette anchor colors', () => {
    const palette = buildExtendedAnsiPalette(DRACULA_ANSI)

    expect(palette[180]).toBe('#ff6e6e')
    expect(palette[30]).toBe('#69ff94')
    expect(palette[210]).toBe('#ffffa5')
    expect(palette[35]).toBe('#a4ffff')
    expect(palette[185]).toBe('#ff92df')
    expect(palette[5]).toBe('#d6acff')
    expect(palette[216]).toBe('#282933')
  })

  it('falls back safely when the source palette is incomplete or invalid', () => {
    const palette = buildExtendedAnsiPalette([])

    expect(palette).toHaveLength(240)
    expect(palette.every((color) => color === '#000000')).toBe(true)
  })
})
