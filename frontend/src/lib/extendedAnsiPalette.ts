const COLOR_CUBE_LEVELS = [0, 95, 135, 175, 215, 255] as const
const GRAYSCALE_START = 8
const GRAYSCALE_STEP = 10
const GRAYSCALE_COUNT = 24
const CHANNEL_MIN = 0
const CHANNEL_MAX = 255
const HEX_RADIX = 16
const HEX_CHANNEL_WIDTH = 2
const ANSI_BLACK_INDEX = 0
const ANSI_BRIGHT_RED_INDEX = 9
const ANSI_BRIGHT_GREEN_INDEX = 10
const ANSI_BRIGHT_YELLOW_INDEX = 11
const ANSI_BRIGHT_BLUE_INDEX = 12
const ANSI_BRIGHT_MAGENTA_INDEX = 13
const ANSI_BRIGHT_CYAN_INDEX = 14
const ANSI_BRIGHT_WHITE_INDEX = 15

type RGB = readonly [number, number, number]

interface CubeAnchors {
  black: RGB
  red: RGB
  green: RGB
  yellow: RGB
  blue: RGB
  magenta: RGB
  cyan: RGB
  white: RGB
}

const ZERO_RGB: RGB = [CHANNEL_MIN, CHANNEL_MIN, CHANNEL_MIN]

/** 根据主题的 16 色锚点生成 xterm ANSI 16-255 扩展调色板。 */
export function buildExtendedAnsiPalette(ansi: readonly string[]): string[] {
  const black = parseHexColor(ansi[ANSI_BLACK_INDEX])
  const white = parseHexColor(ansi[ANSI_BRIGHT_WHITE_INDEX])
  const anchors: CubeAnchors = {
    black,
    red: parseHexColor(ansi[ANSI_BRIGHT_RED_INDEX]),
    green: parseHexColor(ansi[ANSI_BRIGHT_GREEN_INDEX]),
    yellow: parseHexColor(ansi[ANSI_BRIGHT_YELLOW_INDEX]),
    blue: parseHexColor(ansi[ANSI_BRIGHT_BLUE_INDEX]),
    magenta: parseHexColor(ansi[ANSI_BRIGHT_MAGENTA_INDEX]),
    cyan: parseHexColor(ansi[ANSI_BRIGHT_CYAN_INDEX]),
    white,
  }
  const cube: string[] = []
  for (const red of COLOR_CUBE_LEVELS) {
    for (const green of COLOR_CUBE_LEVELS) {
      for (const blue of COLOR_CUBE_LEVELS) {
        cube.push(rgbToHex(interpolateCube(anchors, [red / CHANNEL_MAX, green / CHANNEL_MAX, blue / CHANNEL_MAX])))
      }
    }
  }
  const grayscale = Array.from({ length: GRAYSCALE_COUNT }, (_, index) => {
    const level = GRAYSCALE_START + index * GRAYSCALE_STEP
    return rgbToHex(mixRgb(black, white, level / CHANNEL_MAX))
  })
  return [...cube, ...grayscale]
}

function interpolateCube(anchors: CubeAnchors, levels: RGB): RGB {
  const [red, green, blue] = levels
  const redGreenLow = mixRgb(anchors.black, anchors.red, red)
  const yellowGreenHigh = mixRgb(anchors.green, anchors.yellow, red)
  const blueGreenLow = mixRgb(anchors.blue, anchors.magenta, red)
  const cyanGreenHigh = mixRgb(anchors.cyan, anchors.white, red)
  const greenLow = mixRgb(redGreenLow, yellowGreenHigh, green)
  const greenHigh = mixRgb(blueGreenLow, cyanGreenHigh, green)
  return mixRgb(greenLow, greenHigh, blue)
}

function mixRgb(from: RGB, to: RGB, ratio: number): RGB {
  return [
    from[0] + (to[0] - from[0]) * ratio,
    from[1] + (to[1] - from[1]) * ratio,
    from[2] + (to[2] - from[2]) * ratio,
  ]
}

function parseHexColor(value?: string): RGB {
  if (!value) return ZERO_RGB
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim())
  const hex = match?.[1]
  if (!hex) return ZERO_RGB
  return [
    Number.parseInt(hex.slice(0, 2), HEX_RADIX),
    Number.parseInt(hex.slice(2, 4), HEX_RADIX),
    Number.parseInt(hex.slice(4, 6), HEX_RADIX),
  ]
}

function rgbToHex(rgb: RGB): string {
  return `#${rgb.map(channelToHex).join('')}`
}

function channelToHex(value: number): string {
  const channel = Math.max(CHANNEL_MIN, Math.min(CHANNEL_MAX, Math.round(value)))
  return channel.toString(HEX_RADIX).padStart(HEX_CHANNEL_WIDTH, '0')
}
