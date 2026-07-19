import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

describe('Tabs orientation', () => {
  it('keeps nested horizontal tabs independent from a vertical parent', () => {
    render(<Tabs orientation="vertical" defaultValue="settings"><TabsList aria-label="设置导航"><TabsTrigger value="settings">设置</TabsTrigger></TabsList><TabsContent value="settings"><Tabs orientation="horizontal" defaultValue="dark"><TabsList aria-label="预览模式"><TabsTrigger value="dark">Dark</TabsTrigger><TabsTrigger value="light">Light</TabsTrigger></TabsList></Tabs></TabsContent></Tabs>)

    const outer = screen.getByRole('tablist', { name: '设置导航' })
    const inner = screen.getByRole('tablist', { name: '预览模式' })
    expect(outer).toHaveAttribute('data-orientation', 'vertical')
    expect(inner).toHaveAttribute('data-orientation', 'horizontal')
    expect(inner).toHaveClass('data-[orientation=horizontal]:flex-row')
    expect(inner).not.toHaveClass('group-data-[orientation=vertical]/tabs:flex-col')
    expect(screen.getByRole('tab', { name: 'Dark' })).toHaveClass('data-[orientation=vertical]:w-full')
    expect(screen.getByRole('tab', { name: 'Dark' })).not.toHaveClass('group-data-[orientation=vertical]/tabs:w-full')
  })
})
