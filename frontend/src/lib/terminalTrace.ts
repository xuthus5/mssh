import { Events } from '@wailsio/runtime'

declare global {
  interface Window {
    __msshTrace?: boolean
  }
}

export interface TerminalTraceDetails {
  [key: string]: string | number | null | undefined
}

export interface TerminalTracePayload extends TerminalTraceDetails {
  name: string
  at: number
}

/**
 * Terminal 输入/输出链路调试追踪。
 * 开启条件：window.__msshTrace 为真（后端在 MSSH_LOG_LEVEL=debug 时自动注入）。
 * 输出到 console（需 devtools），同时转发给后端写入日志文件，方便无 devtools 环境采集。
 */
export function terminalTrace(name: string, details?: TerminalTraceDetails) {
  if (typeof window === 'undefined' || !window.__msshTrace) return
  const at = Date.now()
  const payload: TerminalTracePayload = { name, at, ...details }
  console.debug('[mssh-trace]', at, name, details ?? {})
  void Events.Emit('terminal:trace', payload)
}