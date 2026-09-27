import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { Textarea } from '@/components/ui/textarea'
import { t } from '@/i18n'
import type { AICustomCLI, AISettingsInput } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

type AgentSettings = AISettingsInput['interaction']['agent']

function generateCustomCLIID(): string {
  const cryptoRef = globalThis.crypto
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') return cryptoRef.randomUUID().slice(0, 8)
  return Math.random().toString(36).slice(2, 10)
}

function toLines(values: string[]): string {
  return values.join('\n')
}

function fromLines(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
}

// Keeps the raw text locally so a newline typed with Enter is not stripped out
// before the next line can be typed; the trimmed list is only propagated up.
function LinesTextarea({ values, onChange, rows, ariaLabel }: { values: string[]; onChange: (values: string[]) => void; rows: number; ariaLabel?: string }) {
  const [text, setText] = useState(() => toLines(values))
  const emitted = useRef(toLines(values))
  useEffect(() => {
    const incoming = toLines(values)
    if (incoming !== emitted.current) {
      setText(incoming)
      emitted.current = incoming
    }
  }, [values])
  const change = (next: string) => {
    setText(next)
    emitted.current = toLines(fromLines(next))
    onChange(fromLines(next))
  }
  return <Textarea value={text} onChange={(event) => change(event.target.value)} rows={rows} aria-label={ariaLabel} />
}

export function CustomCLICard({ agent, setAgent }: { agent: AgentSettings; setAgent: (changes: Partial<AgentSettings>) => void }) {
  const list = agent.custom_clis ?? []
  const add = () => setAgent({ custom_clis: [...list, { id: generateCustomCLIID(), name: '', command: '', args: [], env: [], prompt_mode: 'stdin', version_arg: '' }] })
  const remove = (id: string) => setAgent({ custom_clis: list.filter((item) => item.id !== id) })
  const patch = (id: string, changes: Partial<AICustomCLI>) => setAgent({ custom_clis: list.map((item) => (item.id === id ? { ...item, ...changes } : item)) })
  return (
    <Card className="shadow-sm">
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="text-sm">{t('自定义 CLI')}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{t('自定义 CLI 只在运行时被拉起，请先在 CLI 内注册 mssh MCP；可用占位符：{workdir}、{prompt}。')}</p>
        </div>
        <Button size="sm" variant="outline" onClick={add}>
          <Plus data-icon="inline-start" />
          {t('添加自定义 CLI')}
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3">
        {list.length === 0
          ? <p className="text-xs text-muted-foreground">{t('还没有自定义 CLI，点击“添加自定义 CLI”开始配置。')}</p>
          : list.map((item) => <CustomCLIEntry key={item.id} item={item} onPatch={patch} onRemove={remove} />)}
      </CardContent>
    </Card>
  )
}

function CustomCLIEntry({ item, onPatch, onRemove }: { item: AICustomCLI; onPatch: (id: string, changes: Partial<AICustomCLI>) => void; onRemove: (id: string) => void }) {
  const patch = (changes: Partial<AICustomCLI>) => onPatch(item.id, changes)
  return <div className="grid gap-3 rounded-lg border border-border p-3 md:grid-cols-2">
    <div className="flex items-center justify-between md:col-span-2">
      <span className="text-xs font-medium">{item.name || t('未命名自定义 CLI')}</span>
      <Button size="sm" variant="ghost" aria-label={t('删除自定义 CLI')} onClick={() => onRemove(item.id)}>
        <Trash2 data-icon="inline-start" className="text-destructive" />
      </Button>
    </div>
    <label className="grid gap-1.5 text-xs text-muted-foreground">
      {t('名称')}
      <Input value={item.name} onChange={(event) => patch({ name: event.target.value })} aria-label={t('自定义 CLI 名称')} />
    </label>
    <label className="grid gap-1.5 text-xs text-muted-foreground">
      {t('命令')}
      <Input value={item.command} onChange={(event) => patch({ command: event.target.value })} aria-label={t('可执行命令')} />
    </label>
    <label className="grid gap-1.5 text-xs text-muted-foreground md:col-span-2">
      {t('参数（每行一个）')}
      <LinesTextarea values={item.args} onChange={(args) => patch({ args })} rows={4} ariaLabel={t('参数（每行一个）')} />
    </label>
    <label className="grid gap-1.5 text-xs text-muted-foreground md:col-span-2">
      {t('环境变量（每行一个 KEY=VALUE）')}
      <LinesTextarea values={item.env} onChange={(env) => patch({ env })} rows={3} ariaLabel={t('环境变量（每行一个 KEY=VALUE）')} />
    </label>
    <div className="grid gap-1.5">
      <span className="text-xs text-muted-foreground">{t('Prompt 传递方式')}</span>
      <LabeledSelect value={item.prompt_mode} onValueChange={(value) => patch({ prompt_mode: value })} ariaLabel={t('Prompt 传递方式')} options={[{ value: 'stdin', label: t('标准输入') }, { value: 'arg', label: t('命令行参数') }]} />
    </div>
    <label className="grid gap-1.5 text-xs text-muted-foreground">
      {t('版本')}
      <Input value={item.version_arg} onChange={(event) => patch({ version_arg: event.target.value })} placeholder="--version" aria-label={t('版本参数（默认 --version）')} />
    </label>
  </div>
}
