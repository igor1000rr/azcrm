// Серверный логгер на pino с JSON-output в проде и pretty-print в dev.
//
// Зачем: console.* в Node.js пишет неструктурированный текст, который
// неудобно парсить из pm2 logs / journalctl / loki / отдавать в Sentry.
// pino выдаёт JSON по строке на запись с уровнем/timestamp/контекстом.
//
// Использование (drop-in замена console):
//   import { logger } from '@/lib/logger';
//   logger.error('[wa-webhook] failed:', err);
//   logger.warn('[google] retry');
//   logger.info({ userId, leadId }, 'lead created');  // структурный — лучше
//
// Уровень логов задаётся через LOG_LEVEL env (debug/info/warn/error/fatal).
// По умолчанию info в проде и debug в dev.

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

export const logger = pino({
  level,
  transport,
  // Стандартные сериализаторы: err преобразует Error в { type, message, stack }
  serializers: {
    err: pino.stdSerializers.err,
  },
  // В проде — чистый stdout (pm2 / docker подхватят).
  // base: { service: 'azcrm-web' } — добавляет константный контекст в каждую запись.
  base: { service: 'azcrm' },
});

/**
 * Создать дочерний логгер с дополнительным контекстом.
 * Полезно для модулей: const log = childLogger({ module: 'wa-webhook' });
 */
export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
