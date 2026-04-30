// Аудит-лог: запись действий пользователей для админа
import { db } from '@/lib/db';
import { headers } from 'next/headers';
import { logger } from '@/lib/logger';

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
      ipAddress = h.get('x-forwarded-for')?.split(',')[0].trim() ?? h.get('x-real-ip') ?? null;
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
