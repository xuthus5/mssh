import { Badge } from '@/components/ui/badge'
import type { TerminalTheme } from '@/hooks/useSettings'

interface Props {
  theme: TerminalTheme
}

function Cursor({ theme }: Props) {
  const dimensions = theme.cursorStyle === 'bar'
    ? { width: '2px', height: '1.15em' }
    : theme.cursorStyle === 'underline'
      ? { width: '0.7em', height: '2px', alignSelf: 'flex-end' }
      : { width: '0.7em', height: '1.15em' }
  return <span data-testid="terminal-theme-cursor" className="inline-block animate-pulse motion-reduce:animate-none" style={{ backgroundColor: theme.cursorColor, ...dimensions }} />
}

export function TerminalThemePreview({ theme }: Props) {
  return <div className="flex flex-col gap-3">
    <div
      data-testid="terminal-theme-preview"
      className="min-h-64 overflow-hidden rounded-xl border border-border p-4 shadow-inner"
      style={{ backgroundColor: theme.background, color: theme.foreground, fontFamily: theme.fontFamily, fontSize: `${theme.fontSize}px` }}
    >
      <div className="flex flex-col gap-2 leading-relaxed">
        <p style={{ color: theme.ansi[8] }}>Last login: Sun Jul 12 13:28:01 from 192.168.1.20</p>
        <p><span style={{ color: theme.ansi[10] }}>root@x-dev</span><span style={{ color: theme.ansi[15] }}>:</span><span style={{ color: theme.ansi[12] }}>~</span><span style={{ color: theme.ansi[15] }}># </span><span data-testid="terminal-selection-preview" className="rounded-sm px-0.5" style={{ backgroundColor: theme.selectionBackground }}>mssh status</span></p>
        <p><span style={{ color: theme.ansi[14] }}>●</span> SSH transport connected <span style={{ color: theme.ansi[10] }}>success</span></p>
        <p><span style={{ color: theme.ansi[11] }}>!</span> 2 sessions are using agent forwarding</p>
        <p><span style={{ color: theme.ansi[9] }}>×</span> staging-node connection timed out</p>
        <p className="flex items-center"><span style={{ color: theme.ansi[10] }}>root@x-dev</span><span>:</span><span style={{ color: theme.ansi[12] }}>~</span><span>#&nbsp;</span><Cursor theme={theme} /></p>
      </div>
    </div>
    <div className="flex flex-wrap gap-2">
      <Badge variant="secondary">{theme.fontFamily}</Badge>
      <Badge variant="secondary">{theme.fontSize}px</Badge>
      <Badge variant="outline">光标：{theme.cursorStyle}</Badge>
      <Badge variant="outline">选区：{theme.selectionBackground}</Badge>
    </div>
  </div>
}
