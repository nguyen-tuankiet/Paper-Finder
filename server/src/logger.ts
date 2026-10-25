export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const SENSITIVE_KEY = /key|token|authorization|password|secret|cookie|email/i;

function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : value;
  }
  return out;
}

/** Log JSON có cấu trúc, một dòng một sự kiện, tự động che các trường nhạy cảm. */
export function createLogger(level: LogLevel = 'info', write: (line: string) => void = console.log): Logger {
  const emit = (lvl: Exclude<LogLevel, 'silent'>, message: string, fields?: Record<string, unknown>) => {
    if (ORDER[lvl] < ORDER[level]) return;
    write(JSON.stringify({ time: new Date().toISOString(), level: lvl, message, ...(fields ? redact(fields) : {}) }));
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}

export const silentLogger: Logger = createLogger('silent');
