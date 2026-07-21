import { useState, type ReactNode, type UIEvent } from 'react'
import { computeVirtualWindow } from '@/lib/virtualWindow'

interface Props<T> {
  items: T[]
  estimateSize: number
  overscan?: number
  className?: string
  getKey: (item: T, index: number) => string
  renderItem: (item: T, index: number) => ReactNode
  empty?: ReactNode
}

export function VirtualList<T>({
  items,
  estimateSize,
  overscan = 5,
  className,
  getKey,
  renderItem,
  empty,
}: Props<T>) {
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(400)
  if (items.length === 0) return <>{empty ?? null}</>
  // jsdom and short lists: render fully when viewport is unknown/small relative to content window needs.
  const effectiveViewport = viewportHeight > 0 ? viewportHeight : Math.min(items.length, 40) * estimateSize
  const windowed = computeVirtualWindow({
    count: items.length,
    estimateSize,
    scrollOffset: scrollTop,
    viewportSize: effectiveViewport,
    overscan: Math.max(overscan, items.length <= 50 ? items.length : overscan),
  })
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop)
    setViewportHeight(event.currentTarget.clientHeight)
  }
  return (
    <div className={className} onScroll={onScroll} style={{ overflow: 'auto', height: '100%' }}>
      <div style={{ height: windowed.totalSize, position: 'relative' }}>
        {windowed.items.map((item) => (
          <div key={getKey(items[item.index], item.index)} style={{ position: 'absolute', top: item.start, left: 0, right: 0, height: item.size }}>
            {renderItem(items[item.index], item.index)}
          </div>
        ))}
      </div>
    </div>
  )
}
