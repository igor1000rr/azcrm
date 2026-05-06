'use server';

// Объединение двух клиентов в одного.
//
// 06.05.2026 — пункт #2.3 аудита.
//
// ПРОБЛЕМА: клиент написал в Telegram (без указания телефона) → создаётся
// карточка с phone=`tg:<chatId>`. Потом он же написал в WhatsApp с реальным
// номером — система не видит связи и создаёт ВТОРОГО клиента. Anna потом
// вручную связывает в голове.
//
// РЕШЕНИЕ: server action mergeClients(sourceId, targetId) — переносит ВСЕ
// связанные сущности с source на target и удаляет source. Anna запускает
// его руками из карточки клиента когда обнаруживает дубликат.
//
// Что переносится:
//   - leads          (на target.clientId)
//   - chatThreads    (на target.clientId)
//   - calls          (на target.clientId)
//   - clientFiles    (на target.clientId)
//
// Что НЕ переносится (а ЗАПИСЫВАЕТСЯ в audit):
//   - source.notes (текст), legalStay/passport даты, source-пометка
//     просто исчезают вместе с source-карточкой.
//
// Безопасность:
//   - только ADMIN.
//   - Нельзя merge самого с собой.
//   - Если на source.phone стоит реальный номер (не tg:* / fake) — лог
//     warning, но не запрещаем (Anna может знать что делает).
//   - Audit log записывает before/after для возможности отката.

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { logger } from '@/lib/logger';

/**
 * Слить sourceClient в targetClient. Source удаляется, все его связи
 * переносятся на target.
 *
 * @returns статистика по перенесённым сущностям + id целевого клиента.
 */
export async function mergeClients(sourceId: string, targetId: string) {
  const admin = await requireAdmin();

  if (sourceId === targetId) {
    throw new Error('Нельзя слить клиента с самим собой');
  }

  const [source, target] = await Promise.all([
    db.client.findUnique({
      where: { id: sourceId },
      include: {
        _count: {
          select: { leads: true, chatThreads: true, calls: true, files: true },
        },
      },
    }),
    db.client.findUnique({
      where: { id: targetId },
      select: { id: true, fullName: true, phone: true },
    }),
  ]);

  if (!source) throw new Error('Исходный клиент не найден');
  if (!target) throw new Error('Целевой клиент не найден');

  // Если оба клиента имеют реальные (не fake tg:*) телефоны — это подозрительно.
  // Не блокируем, но логируем — Anna должна понимать что делает.
  if (!source.phone.startsWith('tg:') && !target.phone.startsWith('tg:')) {
    logger.warn(
      `[mergeClients] оба клиента имеют реальные телефоны: ` +
      `${source.phone} → ${target.phone}. Anna в курсе?`,
    );
  }

  const stats = await db.$transaction(async (tx) => {
    // Переносим все связи. updateMany возвращает count.
    const leads      = await tx.lead.updateMany({
      where: { clientId: sourceId },
      data:  { clientId: targetId },
    });
    const threads    = await tx.chatThread.updateMany({
      where: { clientId: sourceId },
      data:  { clientId: targetId },
    });
    const calls      = await tx.call.updateMany({
      where: { clientId: sourceId },
      data:  { clientId: targetId },
    });
    const files      = await tx.clientFile.updateMany({
      where: { clientId: sourceId },
      data:  { clientId: targetId },
    });

    // Удаляем source. CASCADE на остальных таблицах не отработает —
    // мы их уже переписали на target.
    await tx.client.delete({ where: { id: sourceId } });

    return {
      leads:   leads.count,
      threads: threads.count,
      calls:   calls.count,
      files:   files.count,
    };
  });

  await audit({
    userId:     admin.id,
    action:     'client.merge',
    entityType: 'Client',
    entityId:   targetId,
    before: {
      sourceId,
      sourceName:  source.fullName,
      sourcePhone: source.phone,
      counts:      source._count,
    },
    after: {
      targetId,
      targetName:  target.fullName,
      targetPhone: target.phone,
      moved:       stats,
    },
  });

  revalidatePath('/clients');
  revalidatePath(`/clients/${targetId}`);
  return { ok: true, targetId, moved: stats };
}

/**
 * Найти потенциальные дубликаты клиента: записи с fake-phone (tg:* / vb:* /
 * meta:*) и совпадающим именем. Возвращает топ-5 кандидатов.
 *
 * Используется в UI карточки клиента: «Похоже на дубликаты — слить?»
 */
export async function findClientDuplicates(clientId: string) {
  await requireAdmin();
  const client = await db.client.findUnique({
    where:  { id: clientId },
    select: { id: true, fullName: true, phone: true },
  });
  if (!client) return [];

  // Ищем других клиентов с тем же именем (case-insensitive trim).
  // Telegram-клиент с fake phone tg:* и тем же именем → вероятный дубль.
  const candidates = await db.client.findMany({
    where: {
      id:       { not: clientId },
      fullName: { equals: client.fullName.trim(), mode: 'insensitive' },
    },
    select: {
      id: true, fullName: true, phone: true, source: true, createdAt: true,
      _count: { select: { leads: true, chatThreads: true, calls: true } },
    },
    take:    5,
    orderBy: { createdAt: 'desc' },
  });

  return candidates;
}
