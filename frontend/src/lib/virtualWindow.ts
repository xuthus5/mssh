export interface VirtualWindowOptions {
  count: number
  estimateSize: number
  scrollOffset: number
  viewportSize: number
  overscan?: number
}

export interface VirtualWindowItem {
  index: number
  start: number
  size: number
}

/** Compute a simple fixed-size virtual window for list rendering. */
export function computeVirtualWindow(options: VirtualWindowOptions): {
  items: VirtualWindowItem[]
  totalSize: number
  startIndex: number
  endIndex: number
} {
  const count = Math.max(0, options.count)
  const size = Math.max(1, options.estimateSize)
  const overscan = Math.max(0, options.overscan ?? 4)
  const totalSize = count * size
  if (count === 0 || options.viewportSize <= 0) {
    return { items: [], totalSize, startIndex: 0, endIndex: -1 }
  }
  const rawStart = Math.floor(Math.max(0, options.scrollOffset) / size)
  const visible = Math.ceil(options.viewportSize / size) + 1
  const startIndex = Math.max(0, rawStart - overscan)
  const endIndex = Math.min(count - 1, rawStart + visible + overscan)
  const items: VirtualWindowItem[] = []
  for (let index = startIndex; index <= endIndex; index += 1) {
    items.push({ index, start: index * size, size })
  }
  return { items, totalSize, startIndex, endIndex }
}
