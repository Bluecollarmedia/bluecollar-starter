/**
 * Structured logging foundation.
 * In dev: logs to console with structured data.
 * In production: can be extended to send to a logging service.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

const IS_DEV = __DEV__ ?? process.env.NODE_ENV !== 'production';

function createEntry(
  level: LogLevel,
  message: string,
  data?: Record<string, unknown>,
): LogEntry {
  return {
    level,
    message,
    data,
    timestamp: new Date().toISOString(),
  };
}

function emit(entry: LogEntry): void {
  if (!IS_DEV && entry.level === 'debug') return;

  const prefix = `[${entry.level.toUpperCase()}]`;
  const msg = `${prefix} ${entry.message}`;

  switch (entry.level) {
    case 'error':
      console.error(msg, entry.data ?? '');
      break;
    case 'warn':
      console.warn(msg, entry.data ?? '');
      break;
    case 'debug':
      console.debug(msg, entry.data ?? '');
      break;
    default:
      console.log(msg, entry.data ?? '');
  }
}

export const logger = {
  debug(message: string, data?: Record<string, unknown>) {
    emit(createEntry('debug', message, data));
  },
  info(message: string, data?: Record<string, unknown>) {
    emit(createEntry('info', message, data));
  },
  warn(message: string, data?: Record<string, unknown>) {
    emit(createEntry('warn', message, data));
  },
  error(message: string, data?: Record<string, unknown>) {
    emit(createEntry('error', message, data));
  },
};
