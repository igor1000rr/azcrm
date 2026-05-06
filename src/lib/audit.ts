// Аудит-лог: запись действий пользователей для админа
//
// 07.05.2026 — расширение #2.14 аудита: Используем getClientIpFromHeaders вместо
// прямого разбора X-Forwarded-For — раньше брали .[0] (спуфится юзером). Теперь
// берём N-й с конца (наш trusted proxy дописывает реальный IP в конец).
// Без этого уволенный сотрудник мог бы фальсифицировать IP в audit log перед
// выполнением действия.
import { db } from '@/lib/db';
import { headers } from 'next/headers';
import { logger } from '@/lib/logger';
import { getClientIpFromHeaders } from '@/lib/client-ip';

interface AuditInput {
  userId?:    string | null;
  action:     string;       // 'lead.create', 'payment.delete' и т.д.
  entityType?: string;
  entityId?:   string;
  before?:    Record<string, unknown> | null;
  after?:     Record<string, unknown> | null;
}

/**
 * Записать действие в аудит-лог.
 * Не бросает ошибки чтобы не сломать основное действие.
 */
export async function audit(input: AuditInput): Promise<void> {
  try {
    let ipAddress: string | null = null;
    let userAgent: string | null = null;
    try {
      const h = await headers();
      // Берём IP через общий helper с защитой от spoofingа.
      // 'unknown' преобразуем в null — в БД лучше NULL чем строка "unknown".
      const ip = getClientIpFromHeaders(h);
      ipAddress = ip === 'unknown' ? null : ip;
      userAgent = h.get('user-agent') ?? null;
    } catch {}

    await db.auditLog.create({
      data: {
        userId:     input.userId ?? null,
        action:     input.action,
        entityType: input.entityType ?? null,
        entityId:   input.entityId ?? null,
        before:     (input.before ?? null) as never,
        after:      (input.after  ?? null) as never,
        ipAddress,
        userAgent,
      },
    });
  } catch (e) {
    logger.error('[audit] failed:', e);
  }
}
