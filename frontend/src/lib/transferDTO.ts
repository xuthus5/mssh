import type { TransferJob } from '@/store/appStore'

/** Backend transfer job shape returned by FileService.ListTransfers. */
export interface BackendTransferJobDTO {
  id: string
  session_id: number
  session_name: string
  direction: TransferJob['direction'] | string
  source_path: string
  target_path: string
  total_bytes: number
  transferred_bytes: number
  speed: number
  eta: number
  status: TransferJob['status'] | string
  error?: string | null
  started_at: string
  completed_at?: string | null
}

const directions = new Set(['upload', 'download'])
const statuses = new Set(['queued', 'running', 'completed', 'failed', 'cancelled'])

function fileNameFromPath(path: string): string {
  return String(path).split(/[\\/]/).pop() || path
}

/** Map one backend DTO to the frontend TransferJob. Throws on invalid payloads. */
export function mapBackendTransferJob(raw: unknown): TransferJob {
  if (!raw || typeof raw !== 'object') throw new Error('transfer job is not an object')
  const job = raw as BackendTransferJobDTO
  if (!job.id || typeof job.id !== 'string') throw new Error('transfer job missing id')
  if (!directions.has(String(job.direction))) throw new Error(`invalid transfer direction: ${job.direction}`)
  if (!statuses.has(String(job.status))) throw new Error(`invalid transfer status: ${job.status}`)
  if (typeof job.source_path !== 'string' || typeof job.target_path !== 'string') {
    throw new Error('transfer job missing paths')
  }
  const startedAt = Date.parse(job.started_at)
  if (!Number.isFinite(startedAt)) throw new Error(`invalid started_at: ${job.started_at}`)
  const completedAt = job.completed_at ? Date.parse(job.completed_at) : undefined
  if (job.completed_at && !Number.isFinite(completedAt)) throw new Error(`invalid completed_at: ${job.completed_at}`)
  return {
    id: job.id,
    fileName: fileNameFromPath(job.source_path),
    direction: job.direction as TransferJob['direction'],
    sessionId: Number(job.session_id) || 0,
    sessionName: String(job.session_name ?? ''),
    sourcePath: job.source_path,
    targetPath: job.target_path,
    totalBytes: Number(job.total_bytes) || 0,
    transferredBytes: Number(job.transferred_bytes) || 0,
    speed: Number(job.speed) || 0,
    eta: Number(job.eta) || 0,
    status: job.status as TransferJob['status'],
    error: job.error ? String(job.error) : undefined,
    startedAt,
    completedAt,
  }
}

export function mapBackendTransferJobs(raw: unknown): { jobs: TransferJob[]; errors: string[] } {
  if (!Array.isArray(raw)) return { jobs: [], errors: ['ListTransfers did not return an array'] }
  const jobs: TransferJob[] = []
  const errors: string[] = []
  raw.forEach((item, index) => {
    try {
      jobs.push(mapBackendTransferJob(item))
    } catch (error: unknown) {
      errors.push(`index ${index}: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
  return { jobs, errors }
}
