type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const isDev = import.meta.env.DEV

const noop = () => {}

function createLogger(level: LogLevel) {
  if (isDev) {
    return (...args: unknown[]) => console[level]('[mssh]', ...args)
  }
  return noop
}

export const logger = {
  debug: createLogger('debug'),
  info: createLogger('info'),
  warn: createLogger('warn'),
  error: createLogger('error'),
}
