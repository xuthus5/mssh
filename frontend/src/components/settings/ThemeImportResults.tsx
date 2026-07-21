import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import type { ThemeImportSummary } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { t } from '@/i18n'


export function ThemeImportResults({ summary }: { summary: ThemeImportSummary }) {
  if (summary.results.length === 0) return null
  return <Alert><AlertDescription><div className="flex flex-col gap-2">
    {summary.results.map((result) => <div key={result.file} className="flex items-center gap-2">
      <Badge variant={result.status === 'failed' ? 'destructive' : result.status === 'duplicate' ? 'outline' : 'secondary'}>{result.status === 'imported' ? t('已导入') : result.status === 'duplicate' ? t('已存在') : t('失败')}</Badge>
      <span className="min-w-0 flex-1 truncate">{result.name || result.file}</span>
      {result.error && <span className="text-destructive">{result.error}</span>}
    </div>)}
  </div></AlertDescription></Alert>
}
