'use server';

// Server Actions для управления Viber каналами.
// Подключение через ручной ввод X-Viber-Auth-Token (получается на partners.viber.com).
// Регистрация webhook через POST /pa/set_webhook на стороне Viber.

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireAdmin, requireUser } from '@/lib/auth';
import { setViberWebhook, removeViberWebhook, sendViberText } from '@/lib/viber';
import { canViewLead } from '@/lib/permissions';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

const connectSchema = z.object({
  authToken: z.string().min(40, 'Auth Token обязателен (получи на partners.viber.com)'),
  paName:    z.string().min(1).max(80),
  label:     z.string().min(1).max(80),
  ownerId:   z.string().nullable().optional(),
});

/**
 * Подключает Viber Public Account к CRM:
 *   1. Создаёт запись ViberAccount.
 *   2. Регистрирует webhook на стороне Viber (POST /pa/set_webhook).
 *   3. При неудаче — откатывает создание.
 *
 * webhookUrl формируется как ${APP_PUBLIC_URL}/api/viber/webhook?account=<id>.
 */
export async function connectViberAccount(input: z.infer<typeof connectSchema>) {
  await requireAdmin();
  const data = connectSchema.parse(input);

  // Проверка уникальности по paName (т.к. это unique в schema)
  const exists = await db.viberAccount.findUnique({ where: { paName: data.paName } });
  if (exists) throw new Error(`Public Account "${data.paName}" уже подключён`);

  // Создаём запись (без webhookUrl)
  const account = await db.viberAccount.create({
    data: {
      authToken:   data.authToken,
      paName:      data.paName,
      label:       data.label,
      ownerId:     data.ownerId ?? null,
      isActive:    true,
      isConnected: false,
    },
  });

  // Регистрируем webhook
  const baseUrl = process.env.APP_PUBLIC_URL?.replace(/\/$/, '');
  if (!baseUrl) {
    await db.viberAccount.delete({ where: { id: account.id } });
    throw new Error('APP_PUBLIC_URL не задан в .env — webhook не настроен');
  }
  const webhookUrl = `${baseUrl}/api/viber/webhook?account=${account.id}`;

  try {
    const res = await setViberWebhook(data.authToken, webhookUrl);
    if (res.status !== 0) {
      throw new Error(`Viber отверг webhook: ${res.status_message || 'неизвестная ошибка'}`);
    }
  } catch (e) {
    await db.viberAccount.delete({ where: { id: account.id } });
    throw e;
  }

  await db.viberAccount.update({
    where: { id: account.id },
    data:  { isConnected: true, webhookUrl, lastSeenAt: new Date() },
  });

  revalidatePath('/settings/channels');
  return { ok: true, accountId: account.id };
}

/** Отключение: снимает webhook у Viber и удаляет запись. */
export async function disconnectViberAccount(accountId: string) {
  await requireAdmin();
  const account = await db.viberAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new Error('Аккаунт не найден');

  try { await removeViberWebhook(account.authToken); }
  catch (e) { logger.warn('[viber] removeWebhook failed (игнорируем):', e); }

  await db.viberAccount.delete({ where: { id: accountId } });
  revalidatePath('/settings/channels');
  return { ok: true };
}

export async function toggleViberAccount(accountId: string, isActive: boolean) {
  await requireAdmin();
  await db.viberAccount.update({ where: { id: accountId }, data: { isActive } });
  revalidatePath('/settings/channels');
  return { ok: true };
}

// ============ ОТПРАВКА СООБЩЕНИЯ ИЗ КАРТОЧКИ ЛИДА ============

const sendSchema = z.object({
  leadId:    z.string(),
  accountId: z.string(),
  body:      z.string().min(1).max(4096),
});

const SEND_MAX       = 30;
const SEND_WINDOW_MS = 60 * 1000;

/**
 * Отправляет Viber-сообщение клиенту от имени менеджера.
 * receiverId резолвится из существующего ChatThread (externalId).
 * Если thread'а ещё нет — мы не можем отправить (не знаем Viber-id клиента).
 */
export async function sendViberFromLead(input: z.infer<typeof sendSchema>) {
  const user = await requireUser();
  if (!checkRateLimit(`viber-send:${user.id}`, SEND_MAX, SEND_WINDOW_MS)) {
    throw new Error('Слишком много сообщений. Подождите минуту.');
  }

  const data = sendSchema.parse(input);

  const lead = await db.lead.findUnique({
    where: { id: data.leadId },
    select: {
      id: true, clientId: true,
      salesManagerId: true, legalManagerId: true,
    },
  });
  if (!lead) throw new Error('Лид не найден');
  if (!canViewLead(user, lead)) throw new Error('Нет доступа к лиду');

  const account = await db.viberAccount.findFirst({
    where: { id: data.accountId, isActive: true },
  });
  if (!account) throw new Error('Канал недоступен');
  if (!account.isConnected) throw new Error(`Канал «${account.label}» не подключён`);

  // Найти thread с этим клиентом на этом канале — там лежит externalId (Viber user id)
  const thread = await db.chatThread.findFirst({
    where: {
      clientId:       lead.clientId,
      viberAccountId: account.id,
      channel:        'VIBER',
    },
    select: { id: true, externalId: true },
  });
  if (!thread || !thread.externalId) {
    throw new Error('Клиент ещё не писал в Viber — сначала он должен начать диалог');
  }

  const res = await sendViberText(account, thread.externalId, data.body);
  if (res.status !== 0) {
    throw new Error(`Viber API отверг отправку: ${res.status_message || 'unknown'}`);
  }

  await db.$transaction([
    db.chatMessage.create({
      data: {
        threadId:       thread.id,
        viberAccountId: account.id,
        direction:      'OUT',
        type:           'TEXT',
        body:           data.body,
        externalId:     res.message_token ? String(res.message_token) : null,
        senderId:       user.id,
      },
    }),
    db.chatThread.update({
      where: { id: thread.id },
      data: {
        lastMessageAt:   new Date(),
        lastMessageText: data.body.slice(0, 200),
      },
    }),
  ]);

  revalidatePath(`/clients/${data.leadId}`);
  revalidatePath('/inbox');
  return { ok: true };
}
