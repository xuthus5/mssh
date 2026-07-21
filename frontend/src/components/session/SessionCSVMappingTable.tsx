import { useMemo } from 'react'
import type { SessionCSVPreview } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { Input } from '@/components/ui/input'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { SESSION_CSV_FIELDS, sessionCSVSample, updateSessionCSVMapping, type SessionCSVValues } from '@/lib/sessionCSVMapping'
import { t } from '@/i18n'


interface SessionCSVMappingTableProps {
  preview: SessionCSVPreview
  mapping: SessionCSVValues
  defaults: SessionCSVValues
  onMappingChange: (mapping: SessionCSVValues) => void
  onDefaultChange: (key: string, value: string) => void
}

export function SessionCSVMappingTable(props: SessionCSVMappingTableProps) {
  return <div className="overflow-hidden rounded-xl border border-border"><div className="border-b border-border bg-muted/40 px-3 py-2"><div className="text-sm font-medium">{t('字段映射')}</div><div className="mt-0.5 text-xs text-muted-foreground">{t('一个外部表头只能对应一个 MSSH 字段；未映射字段使用默认值。')}</div></div><div className="max-h-[38vh] overflow-auto"><table className="w-full min-w-[760px] text-sm"><thead className="sticky top-0 z-10 bg-background"><tr className="border-b border-border"><th className="w-36 px-3 py-2 text-left font-medium">{t('MSSH 字段')}</th><th className="w-64 px-3 py-2 text-left font-medium">{t('外部表头')}</th><th className="w-52 px-3 py-2 text-left font-medium">{t('默认值')}</th><th className="px-3 py-2 text-left font-medium">{t('样例')}</th></tr></thead><tbody>{SESSION_CSV_FIELDS.map((field) => <MappingRow key={field.key} field={field} {...props} />)}</tbody></table></div></div>
}

function MappingRow({ field, preview, mapping, defaults, onMappingChange, onDefaultChange }: SessionCSVMappingTableProps & { field: typeof SESSION_CSV_FIELDS[number] }) {
  const options = useMemo(() => {
    const used = new Set(Object.entries(mapping).filter(([key, value]) => key !== field.key && value).map(([, value]) => value))
    return [{ value: '', label: t('不映射') }, ...preview.headers.filter((header) => !used.has(header)).map((header) => ({ value: header, label: header }))]
  }, [field.key, mapping, preview.headers])
  const source = mapping[field.key] ?? ''
  return <tr className="border-b border-border last:border-0"><td className="px-3 py-2 align-top"><span className="font-medium">{field.label}</span>{field.required && <span className="ml-1 text-destructive">*</span>}<div className="text-[11px] text-muted-foreground">{field.key}</div></td><td className="px-3 py-2 align-top"><LabeledSelect ariaLabel={t('${}外部表头', field.label)} value={source} options={options} onValueChange={(value) => onMappingChange(updateSessionCSVMapping(mapping, field.key, value))} placeholder={t('选择外部表头')} /></td><td className="px-3 py-2 align-top"><Input aria-label={t('${}默认值', field.label)} value={defaults[field.key] ?? ''} placeholder={field.placeholder} onChange={(event) => onDefaultChange(field.key, event.target.value)} /></td><td className="max-w-72 px-3 py-2 align-top text-xs text-muted-foreground"><span className="break-words">{source ? sessionCSVSample(preview.headers, preview.sample_rows, source) || t('（空）') : t('未映射')}</span></td></tr>
}
