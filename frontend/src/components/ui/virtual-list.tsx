import { useEffect, useRef, useState, type ReactNode, type UIEvent } from 'react'
import { computeVirtualWindow } from '@/lib/virtualWindow'

interface Props<T> {
  items: T[]
  estimateSize: number
  overscan?: number
  className?: string
  getKey: (item: T, index: number) => string
  renderItem: (item: T, index: number) => ReactNode
  empty?: ReactNode
  scrollToIndex?: number
}

export function VirtualList<T>({
  items, estimateSize, overscan = 5, className, getKey, renderItem, empty, scrollToIndex,
}: Props<T>) {
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(400)
  const viewportRef = useRef<HTMLDivElement>(null)
  const viewportHeightRef = useRef(400)
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || scrollToIndex === undefined || scrollToIndex < 0 || scrollToIndex >= items.length) return
    const nextScrollTop = scrollOffsetForIndex({
      scrollTop: viewport.scrollTop, viewportHeight: viewportHeightRef.current,
      itemSize: estimateSize, index: scrollToIndex,
    })
    if (nextScrollTop === viewport.scrollTop) return
    viewport.scrollTop = nextScrollTop
    setScrollTop(nextScrollTop)
  }, [estimateSize, items.length, scrollToIndex])
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
    if (event.currentTarget.clientHeight > 0) {
      viewportHeightRef.current = event.currentTarget.clientHeight
      setViewportHeight(event.currentTarget.clientHeight)
    }
  }
  return (
    <div ref={viewportRef} className={className} onScroll={onScroll} style={{ overflow: 'auto', height: '100%' }}>
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

interface ScrollOffsetOptions {
  scrollTop: number
  viewportHeight: number
  itemSize: number
  index: number
}

function scrollOffsetForIndex({ scrollTop, viewportHeight, itemSize, index }: ScrollOffsetOptions) {
  const itemStart = index * itemSize
  const itemEnd = itemStart + itemSize
  if (itemStart < scrollTop) return itemStart
  if (itemEnd > scrollTop + viewportHeight) return itemEnd - viewportHeight
  return scrollTop
}
