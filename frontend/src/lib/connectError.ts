/** Map backend connect errors to user-facing copy (host-key change, etc.). */

const hostKeyChangedRe = /host key for (.+?) changed/i

export function formatConnectError(raw: string, t: (key: string, ...args: Array<string | number>) => string): string {
  const message = (raw ?? '').trim()
  if (!message) return t('连接失败')
  if (hostKeyChangedRe.test(message) || /possible MITM/i.test(message)) {
    const summary = t('主机密钥已变更，连接已阻止。如确认服务器已重装或密钥轮换，请在安全设置中删除旧指纹后重试。')
    return summary + '\n' + message
  }
  return message
}
