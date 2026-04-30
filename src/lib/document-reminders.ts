// Anna идея №7 «Календарь сроков виз и документов».
//
// Cron-функция: проходит всех клиентов с заполненными legalStayUntil или
// passportExpiresAt и шлёт менеджеру уведомление за 90/30/14 дней до
// истечения. Цель — превратить разовых клиентов в постоянных: менеджер
// первым звонит с предложением продлить, а не клиент панически ищет помощь.
//
// Логика дедупликации:
//   - На клиенте 6 boolean флагов (legalStay/passport × 90/30/14).
//   - Когда уведомление уходит — флаг ставится в true.
//   - При смене даты в updateClient флаги сбрасываются (см. actions.ts).
//   - Если осталось <=14 дней → шлём 14-day и ставим ВСЕ три флага (90/30/14):
//     более ранние пороги уже бесполезны.
//   - Если 14 < days <= 30 → 30-day + флаги 30/90.
//   - Если 30 < days <= 90 → 90-day + флаг 90.
//
// Кому шлём:
//   - legalManager последнего активного (не архивного) лида клиента
//   - если legal не назначен → salesManager того же лида
//   - если ни одного — клиент без менеджера, пропускаем

import { db } from '@/lib/db';
import { notify } from '@/lib/notify';
import { plural } from '@/lib/utils';
import { logger } from '@/lib/logger';

interface CheckResult {
  sent:   number;
  errors: number;
}

type DocKind = 'legalStay' | 'passport';

const DOC_LABEL: Record<DocKind, string> = {
  legalStay: 'легальный побыт',
  passport:  'паспорт',
};

/** Сколько дней осталось до даты d считая от now. Округление вверх:
 *  если осталось 89.5 дней — вернёт 90 (ещё в окне 90-day напоминания). */
function daysBetween(now: Date, d: Date): number {
  return Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
}

interface ClientWithLeads {
  id:              string;
  fullName:        string;
  legalStayUntil:  Date | null;
  passportExpiresAt: Date | null;
  legalStayReminder90Sent: boolean;
  legalStayReminder30Sent: boolean;
  legalStayReminder14Sent: boolean;
  passportReminder90Sent:  boolean;
  passportReminder30Sent:  boolean;
  passportReminder14Sent:  boolean;
  leads: Array<{ id: string; salesManagerId: string | null; legalManagerId: string | null }>;
}

/** Возвращает 14, 30, 90 или null — самый узкий порог в который попадает срок. */
export function pickThreshold(daysLeft: number): 14 | 30 | 90 | null {
  if (daysLeft <= 0)  return null;        // уже истёк
  if (daysLeft <= 14) return 14;
  if (daysLeft <= 30) return 30;
  if (daysLeft <= 90) return 90;
  return null;                            // ещё рано
}

/** Решение: нужно ли слать напоминание данного порога с учётом текущих флагов. */
export function shouldSend(
  threshold: 14 | 30 | 90,
  flags: { r90: boolean; r30: boolean; r14: boolean },
): boolean {
  if (threshold === 14) return !flags.r14;
  if (threshold === 30) return !flags.r30;
  return !flags.r90;
}

/** Какие флаги выставить ПОСЛЕ отправки напоминания данного порога. */
export function flagsToSet(threshold: 14 | 30 | 90): Partial<Record<'r90' | 'r30' | 'r14', true>> {
  if (threshold === 14) return { r90: true, r30: true, r14: true };
  if (threshold === 30) return { r90: true, r30: true };
  return { r90: true };
}

/** Маппинг наших внутренних r90/r30/r14 → имена полей в БД для конкретного типа документа. */
function dbFieldName(docKind: DocKind, key: 'r90' | 'r30' | 'r14'): string {
  const prefix = docKind === 'legalStay' ? 'legalStayReminder' : 'passportReminder';
  const num = key === 'r90' ? '90' : key === 'r30' ? '30' : '14';
  return `${prefix}${num}Sent`;
}

async function processOne(
  client: ClientWithLeads,
  docKind: DocKind,
  expiresAt: Date,
  daysLeft: number,
): Promise<boolean> {
  const threshold = pickThreshold(daysLeft);
  if (threshold === null) return false;

  const flags = docKind === 'legalStay'
    ? {
      r90: client.legalStayReminder90Sent,
      r30: client.legalStayReminder30Sent,
      r14: client.legalStayReminder14Sent,
    }
    : {
      r90: client.passportReminder90Sent,
      r30: client.passportReminder30Sent,
      r14: client.passportReminder14Sent,
    };

  if (!shouldSend(threshold, flags)) return false;

  const lead = client.leads[0];
  if (!lead) return false;
  const managerId = lead.legalManagerId ?? lead.salesManagerId;
  if (!managerId) return false;

  const docLabel = DOC_LABEL[docKind];
  const dateStr = expiresAt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const daysWord = plural(daysLeft, 'день', 'дня', 'дней');

  await notify({
    userId: managerId,
    kind:   'DOCUMENT_EXPIRY_REMINDER',
    title:  `Через ${daysLeft} ${daysWord} истекает ${docLabel}: ${client.fullName}`,
    body:   `У клиента «${client.fullName}» ${dateStr} заканчивается ${docLabel}. ` +
            `Свяжитесь с клиентом — предложите продлить.`,
    link:   `/clients/${lead.id}`,
  });

  // Атомарно обновляем флаги (только нужные для этого порога)
  const setFlags = flagsToSet(threshold);
  const data: Record<string, true> = {};
  for (const [key, val] of Object.entries(setFlags)) {
    if (val) data[dbFieldName(docKind, key as 'r90' | 'r30' | 'r14')] = true;
  }

  await db.client.update({
    where: { id: client.id },
    data,
  });

  return true;
}

/** Главная функция cron-блока. Возвращает счётчики для логирования. */
export async function checkExpiringDocuments(now: Date = new Date()): Promise<CheckResult> {
  let sent = 0, errors = 0;

  // Берём всех клиентов у которых ХОТЯ БЫ ОДНА дата заполнена и есть активный лид.
  // Прицельный фильтр по дате (gte: now-1day чтобы не таскать давно истекшие).
  const clients = await db.client.findMany({
    where: {
      isArchived: false,
      OR: [
        { legalStayUntil:    { gte: now } },
        { passportExpiresAt: { gte: now } },
      ],
      leads: { some: { isArchived: false } },
    },
    select: {
      id:                       true,
      fullName:                 true,
      legalStayUntil:           true,
      passportExpiresAt:        true,
      legalStayReminder90Sent:  true,
      legalStayReminder30Sent:  true,
      legalStayReminder14Sent:  true,
      passportReminder90Sent:   true,
      passportReminder30Sent:   true,
      passportReminder14Sent:   true,
      leads: {
        where: { isArchived: false },
        orderBy: { updatedAt: 'desc' },
        take: 1,
        select: { id: true, salesManagerId: true, legalManagerId: true },
      },
    },
  });

  for (const c of clients) {
    if (c.legalStayUntil) {
      try {
        const days = daysBetween(now, c.legalStayUntil);
        if (await processOne(c, 'legalStay', c.legalStayUntil, days)) sent++;
      } catch (e) {
        logger.error(`expiring legalStay for client ${c.id} failed:`, e);
        errors++;
      }
    }
    if (c.passportExpiresAt) {
      try {
        const days = daysBetween(now, c.passportExpiresAt);
        if (await processOne(c, 'passport', c.passportExpiresAt, days)) sent++;
      } catch (e) {
        logger.error(`expiring passport for client ${c.id} failed:`, e);
        errors++;
      }
    }
  }

  return { sent, errors };
}
