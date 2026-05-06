'use server';

// Server Actions для управления Meta каналами (FB Messenger + Instagram Direct).
//
// 06.05.2026 — пункт #5/#8 аудита: pageAccessToken и appSecret шифруются при
// записи в БД через AES-256-GCM. verifyToken НЕ шифруем — он не секрет в строгом
// смысле (FB прислал в публичном webhook URL), хотя теоретически тоже можно.
// При чтении (sendMetaFromLead, webhook handler) — расшифровываем через decrypt().
//
// Lazy migration: legacy plaintext токены без префикса v1: возвращаются как есть.

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireAdmin, requireUser } from '@/lib/auth';
import { sendMessengerText, sendInstagramText } from '@/lib/meta';
import { canViewLead } from '@/lib/permissions';
import { checkRateLimit } from '@/lib/rate-limit';
import { encrypt, decrypt } from '@/lib/crypto';

const GRAPH = 'https://graph.facebook.com/v19.0';

const connectSchema = z.object({
  pageAccessToken: z.string().min(20, 'Page Access Token обязателен'),
  appSecret:       z.string().min(10, 'App Secret обязателен'),
  verifyToken:     z.string().min(4, 'Verify Token обязателен (придумайте сами)'),
  label:           z.string().min(1).max(80),
  ownerId:         z.string().nullable().optional(),
});

interface MePageResponse {
  id?:   string;
  name?: string;
  instagram_business_account?: { id: string; username?: string };
  error?: { message: string; type?: string };
}

export async function connectMetaAccount(input: z.infer<typeof connectSchema>) {
  await requireAdmin();
  const data = connectSchema.parse(input);

  // Валидируем токен через Graph API (нужен plaintext)
  const url = `${GRAPH}/me?fields=id,name,instagram_business_account{id,username}&access_token=${encodeURIComponent(data.pageAccessToken)}`;
  const res = await fetch(url);
  const me: MePageResponse = await res.json();

  if (me.error || !me.id || !me.name) {
    throw new Error(`Page Access Token невалиден: ${me.error?.message || 'нет id/name в ответе'}`);
  }

  const exists = await db.metaAccount.findUnique({ where: { pageId: me.id } });
  if (exists) throw new Error(`FB Page "${me.name}" уже подключена`);

  const igAccount = me.instagram_business_account;

  // Шифруем pageAccessToken и appSecret. verifyToken оставляем plaintext
  // (используется только в GET-верификации webhook'а сравнением строк).
  const account = await db.metaAccount.create({
    data: {
      pageId:          me.id,
      pageAccessToken: encrypt(data.pageAccessToken),
      pageName:        me.name,
      appSecret:       encrypt(data.appSecret),
      verifyToken:     data.verifyToken,
      igUserId:        igAccount?.id ?? null,
      igUsername:      igAccount?.username ?? null,
      hasMessenger:    true,
      hasInstagram:    Boolean(igAccount),
      label:           data.label,
      ownerId:         data.ownerId ?? null,
      isActive:        true,
      isConnected:     true,
    },
  });

  revalidatePath('/settings/channels');
  return {
    ok:        true,
    accountId: account.id,
    pageName:  me.name,
    hasInstagram: Boolean(igAccount),
    igUsername:   igAccount?.username ?? null,
  };
}

export async function disconnectMetaAccount(accountId: string) {
  await requireAdmin();
  const account = await db.metaAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new Error('Аккаунт не найден');

  await db.metaAccount.delete({ where: { id: accountId } });
  revalidatePath('/settings/channels');
  return { ok: true };
}

export async function toggleMetaAccount(accountId: string, isActive: boolean) {
  await requireAdmin();
  await db.metaAccount.update({ where: { id: accountId }, data: { isActive } });
  revalidatePath('/settings/channels');
  return { ok: true };
}

// ============ ОТПРАВКА СООБЩЕНИЯ ИЗ КАРТОЧКИ ЛИДА ============

const sendSchema = z.object({
  leadId:    z.string(),
  accountId: z.string(),
  channel:   z.enum(['MESSENGER', 'INSTAGRAM']),
  body:      z.string().min(1).max(2000),
});

const SEND_MAX       = 30;
const SEND_WINDOW_MS = 60 * 1000;

export async function sendMetaFromLead(input: z.infer<typeof sendSchema>) {
  const user = await requireUser();
  if (!checkRateLimit(`meta-send:${user.id}`, SEND_MAX, SEND_WINDOW_MS)) {
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

  const account = await db.metaAccount.findFirst({
    where: { id: data.accountId, isActive: true },
  });
  if (!account) throw new Error('Канал недоступен');
  if (!account.isConnected) throw new Error(`Канал «${account.label}» не подключён`);

  if (data.channel === 'INSTAGRAM' && !account.hasInstagram) {
    throw new Error('Instagram не подключён к этой Page');
  }

  const thread = await db.chatThread.findFirst({
    where: {
      clientId:      lead.clientId,
      metaAccountId: account.id,
      channel:       data.channel,
    },
    select: { id: true, externalId: true },
  });
  if (!thread || !thread.externalId) {
    throw new Error('Клиент ещё не писал — сначала он должен начать диалог');
  }

  // Расшифровываем pageAccessToken перед отправкой
  const decryptedAccount = { ...account, pageAccessToken: decrypt(account.pageAccessToken) };
  const sender = data.channel === 'INSTAGRAM' ? sendInstagramText : sendMessengerText;
  const res = await sender(decryptedAccount, thread.externalId, data.body);
  if (res.error) {
    throw new Error(`Meta API отверг отправку: ${res.error.message}`);
  }

  await db.$transaction([
    db.chatMessage.create({
      data: {
        threadId:      thread.id,
        metaAccountId: account.id,
        direction:     'OUT',
        type:          'TEXT',
        body:          data.body,
        externalId:    res.message_id ?? null,
        senderId:      user.id,
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
