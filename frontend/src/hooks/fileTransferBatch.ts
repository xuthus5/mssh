import { t } from '@/i18n'

type UploadFile = (localPath: string, remotePath: string) => Promise<void>

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function uploadFileBatch(localPaths: string[], remotePath: string, upload: UploadFile): Promise<void> {
  const results = await Promise.allSettled(localPaths.map((localPath) => upload(localPath, remotePath)))
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failures.length === 0) return
  throw new Error(t('${} 个文件未能加入传输队列: ${}', failures.length, errorMessage(failures[0].reason)))
}
