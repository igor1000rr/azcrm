'use server';

// Server Actions для управления Telegram-каналами
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import {
  getMe, setWebhook, deleteWebhook, sendMessage,
  getWebhookSecret, getWebhookUrl,
} from '@/lib/telegram';
import { logger } from '@/lib/logger';

const connectSchema = z.object({
  token:   z.string().min(40, 'Токен бота обязателен (получи у @BotFather)'),
  label:   z.string().min(1).max(80),
  ownerId: z.string().nullable().optional(),
});

/**
 * Подключает Telegram-бота к CRM:
 *   1. getMe(token) чтобы проверить токен и вытянуть username
 *   2. Создать запись TelegramAccount
 *   3. setWebhook(token, url, secret) — регистрируем webhook у Telegram
 *   4. Обновить isConnected = true и сохранить webhookUrl
 */
export async function connectTelegramBot(input: z.infer<typeof connectSchema>) {
  await requireAdmin();
  const data = connectSchema.parse(input);

  // 1. Проверяем токен
  const me = await getMe(data.token);
  if (!me.is_bot) throw new Error('Этот токен принадлежит не боту');
  if (!me.username) throw new Error('Бот не имеет username — задайте его в @BotFather');

  // Нет ли уже бота с таким username?
  const exists = await db.telegramAccount.findUnique({ where: { botUsername: me.username } });
  if (exists) throw new Error(`Бот @${me.username} уже подключён к CRM`);

  // 2. Создаём запись (без webhookUrl пока)
  const account = await db.telegramAccount.create({
    data: {
      botToken:    data.token,
      botUsername: me.username,
      label:       data.label,
      ownerId:     data.ownerId ?? null,
      isActive:    true,
      isConnected: false,
    },
  });

  // 3. Регистрируем webhook у Telegram
  let webhookUrl: string;
  try {
    webhookUrl = getWebhookUrl(account.id);
    const secret = getWebhookSecret(account.id);
    await setWebhook(data.token, webhookUrl, secret);
  } catch (e) {
    // Откативаем создание аккаунта при ошибке setWebhook
    await db.telegramAccount.delete({ where: { id: account.id } });
    throw e;
  }

  await db.telegramAccount.update({
    where: { id: account.id },
    data:  { isConnected: true, webhookUrl, lastSeenAt: new Date() },
  });

  revalidatePath('/settings/channels');
  return { ok: true, accountId: account.id, botUsername: me.username };
}

/**
 * Отключает Telegram-бота:
 *   1. deleteWebhook у Telegram (без ошибок если webhook уже сломан)
 *   2. Удаляет запись TelegramAccount (FK CASCADE нет — лиды/треды останутся с nullable accountId)
 */
export async function disconnectTelegramBot(accountId: string) {
  await requireAdmin();
  const account = await db.telegramAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new Error('Аккаунт не найден');

  try { await deleteWebhook(account.botToken); }
  catch (e) { logger.warn('[tg] deleteWebhook failed (игнорируем):', e); }

  await db.telegramAccount.delete({ where: { id: accountId } });
  revalidatePath('/settings/channels');
  return { ok: true };
}

export async function toggleTelegramBot(accountId: string, isActive: boolean) {
  await requireAdmin();
  await db.telegramAccount.update({ where: { id: accountId }, data: { isActive } });
  revalidatePath('/settings/channels');
  return { ok: true };
}

const sendSchema = z.object({
  accountId: z.string(),
  chatId:    z.union([z.string(), z.number()]),
  text:      z.string().min(1).max(4096),
});

/** Отправляет сообщение от имени бота + сохраняет в ChatMessage. */
export async function sendTelegramMessage(input: z.infer<typeof sendSchema>) {
  const data = sendSchema.parse(input);

  const account = await db.telegramAccount.findUnique({
    where: { id: data.accountId },
    select: { id: true, botToken: true, isActive: true },
  });
  if (!account || !account.isActive) throw new Error('Аккаунт не найден или отключён');

  const sent = await sendMessage(account.botToken, data.chatId, data.text);

  // Найдём тред и запишем сообщение в базу
  const thread = await db.chatThread.findFirst({
    where: {
      channel: 'TELEGRAM',
      telegramAccountId: account.id,
      externalId: String(data.chatId),
    },
    select: { id: true },
  });

  if (thread) {
    await db.$transaction([
      db.chatMessage.create({
        data: {
          threadId:          thread.id,
          telegramAccountId: account.id,
          direction:         'OUT',
          type:              'TEXT',
          body:              data.text,
          externalId:        `${sent.message_id}`,
          createdAt:         new Date(sent.date * 1000),
        },
      }),
      db.chatThread.update({
        where: { id: thread.id },
        data: {
          lastMessageAt:   new Date(sent.date * 1000),
          lastMessageText: data.text.slice(0, 200),
        },
      }),
    ]);
  }

  revalidatePath('/inbox');
  return { ok: true, messageId: sent.message_id };
}
