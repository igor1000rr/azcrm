// Серверный логгер на pino с JSON-output в проде и pretty-print в dev.
//
// Зачем: console.* в Node.js пишет неструктурированный текст, который
// неудобно парсить из pm2 logs / journalctl / loki / отдавать в Sentry.
// pino выдаёт JSON по строке на запись с уровнем/timestamp/контекстом.
//
// Использование (drop-in замена console):
//   import { logger } from '@/lib/logger';
//   logger.error('[wa-webhook] failed:', err);          // console-style, OK
//   logger.warn('[google] retry attempt', n, 'of', m);  // console-style, OK
//   logger.info({ userId, leadId }, 'lead created');    // pino-style, лучше
//
// Уровень логов задаётся через LOG_LEVEL env (debug/info/warn/error/fatal).
// По умолчанию info в проде и debug в dev.
//
// ВАЖНО: экспортируется console-совместимая обёртка, а НЕ голый pino.
// Pino LogFn в TypeScript имеет узкие overload'ы и ругается на console-style
// вызовы вида logger.error('msg', someStr, someErr) — TS не может выбрать
// перегрузку. Обёртка принимает unknown[] rest args и сама решает как
// прокинуть в pino: object-первым-аргументом → pino-style, иначе → склеивает
// в msg и Error → context.err для структурного вывода.

import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';
const level = process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info');

// pino-pretty в dev — читаемый цветной вывод. В проде — чистый JSON.
const transport = isDev
  ? {
      target: 'pino-pretty',
      options: {
        colorize:        true,
        translateTime:   'HH:MM:ss',
        ignore:          'pid,hostname',
        singleLine:      false,
      },
    }
  : undefined;

const base = pino({
  level,
  transport,
  // Стандартные сериализаторы: err преобразует Error в { type, message, stack }
  serializers: {
    err: pino.stdSerializers.err,
  },
  // base.service = 'azcrm' — добавляет константный контекст в каждую запись.
  base: { service: 'azcrm' },
});

type Level = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

function stringify(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v instanceof Error)    return v.message;
  if (v == null)             return String(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}

/**
 * Универсальный диспатч: принимает любую сигнатуру вызова и нормализует
 * под pino. Логика:
 *   - Если первый arg — обычный объект (не Error, не null) → pino-style:
 *     передаём как контекст, второй arg как msg.
 *   - Иначе console-style: первый arg — msg (строкуем), остальные:
 *       - Error'ы → собираются в контекст { err } (или { errs } если несколько)
 *       - Прочее → конкатенируется в msg через пробел
 */
function call(lvl: Level, args: unknown[]): void {
  if (args.length === 0) return;

  const first = args[0];
  if (first !== null && typeof first === 'object' && !(first instanceof Error)) {
    // pino-style: передаём как есть. Cast через unknown — TS не сматчит overload'ы.
    (base[lvl] as unknown as (...a: unknown[]) => void)(...args);
    return;
  }

  // console-style
  const msgParts: string[] = [stringify(first)];
  const errors: Error[] = [];
  for (const a of args.slice(1)) {
    if (a instanceof Error) errors.push(a);
    else                    msgParts.push(stringify(a));
  }
  const msg = msgParts.join(' ');

  if (errors.length === 0) {
    base[lvl](msg);
  } else if (errors.length === 1) {
    base[lvl]({ err: errors[0] }, msg);
  } else {
    base[lvl]({ errs: errors }, msg);
  }
}

export const logger = {
  debug: (...args: unknown[]) => call('debug', args),
  info:  (...args: unknown[]) => call('info',  args),
  warn:  (...args: unknown[]) => call('warn',  args),
  error: (...args: unknown[]) => call('error', args),
  fatal: (...args: unknown[]) => call('fatal', args),
};

/**
 * Создать дочерний логгер с дополнительным контекстом.
 * Полезно для модулей: const log = childLogger({ module: 'wa-webhook' });
 * Возвращает голый pino.Logger (без console-style обёртки) — для модулей,
 * которые хотят полный pino API.
 */
export function childLogger(bindings: Record<string, unknown>) {
  return base.child(bindings);
}
