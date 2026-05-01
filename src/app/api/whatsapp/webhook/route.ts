// POST /api/whatsapp/webhook
// Worker вызывает этот endpoint при событиях:
//   - 'message.in'     — входящее сообщение
//   - 'message.status' — статус доставки исходящего
//   - 'connection'     — изменение статуса подключения
//
// Логика для входящих:
//   1. Найти клиента по номеру телефона (нормализованному)
//   2. Если нет — создать ТОЛЬКО клиента (без лида).
//      Лид менеджер создаст вручную через карточку клиента, выбрав
//      нужную воронку и этап. Это поведение по требованию Anna —
//      раньше лид создавался автоматом в дефолтной воронке "Praca",
//      что было неудобно: бывают консультации, ошибочные обращения,
//      просто переписка. Теперь сначала переписка → потом ручное
//      решение в какую воронку положить.
//   3. Найти/создать ChatThread
//   4. Создать ChatMessage, инкрементить unreadCount
//   5. Обновить lastMessageAt в треде

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { verifyWebhookToken } from '@/lib/whatsapp';
import { normalizePhone } from '@/lib/utils';
import { revalidatePath } from 'next/cache';
import { notify } from '@/lib/notify';
import { parseBody } from '@/lib/api-validation';

// ============ ZOD-СХЕМЫ ============
// Worker — наш код, но JSON.parse от него всё равно может прийти битый
// (баг в worker, partial write, версия рассинхронизирована). Лучше упасть
// на 400 чем на TypeError в логике.

const IncomingMessageSchema = z.object({
  kind:        z.literal('message.in'),
  accountId:   z.string().min(1).max(64),
  externalId:  z.string().min(1).max(256),
  fromPhone:   z.string().min(3).max(40),
  fromName:    z.string().max(200).optional(),
  type:        z.enum(['text', 'image', 'document', 'audio', 'video', 'location', 'contact']),
  body:        z.string().max(20_000).optional(),
  mediaUrl:    z.string().max(2048).optional(),
  mediaName:   z.string().max(512).optional(),
  mediaSize:   z.number().int().nonnegative().max(100 * 1024 * 1024).optional(),
  timestamp:   z.number().int().nonnegative(),
});

const ConnectionEventSchema = z.object({
  kind:        z.literal('connection'),
  accountId:   z.string().min(1).max(64),
  status:      z.enum(['qr', 'authenticating', 'ready', 'disconnected', 'failed']),
  phoneNumber: z.string().max(40).optional(),
});

const MessageStatusSchema = z.object({
  kind:        z.literal('message.status'),
  accountId:   z.string().min(1).max(64),
  externalId:  z.string().min(1).max(256),
  status:      z.enum(['sent', 'delivered', 'read', 'failed']),
});

const WebhookSchema = z.discriminatedUnion('kind', [
  IncomingMessageSchema,
  ConnectionEventSchema,
  MessageStatusSchema,
]);

type IncomingMessage = z.infer<typeof IncomingMessageSchema>;
type ConnectionEvent = z.infer<typeof ConnectionEventSchema>;
type MessageStatus   = z.infer<typeof MessageStatusSchema>;

export async function POST(req: NextRequest) {
  // Проверка токена
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!verifyWebhookToken(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parsed = await parseBody(req, WebhookSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  switch (body.kind) {
    case 'message.in':
      return handleIncomingMessage(body);
    case 'message.status':
      return handleMessageStatus(body);
    case 'connection':
      return handleConnection(body);
  }
}

async function handleIncomingMessage(msg: IncomingMessage) {
  // Дедупликация — если такое сообщение уже было, выходим
  const existing = await db.chatMessage.findFirst({
    where: { externalId: msg.externalId, whatsappAccountId: msg.accountId },
    select: { id: true },
  });
  if (existing) return NextResponse.json({ ok: true, deduplicated: true });

  const phone = normalizePhone(msg.fromPhone);

  // Найти аккаунт
  const account = await db.whatsappAccount.findUnique({
    where: { id: msg.accountId },
    select: { id: true, ownerId: true, label: true, phoneNumber: true },
  });
  if (!account) return NextResponse.json({ error: 'account not found' }, { status: 404 });

  // Найти клиента по номеру. Если нет — создаём ТОЛЬКО клиента.
  // Лид менеджер создаст вручную из карточки клиента (см. комментарий
  // в шапке файла).
  let client = await db.client.findUnique({ where: { phone } });

  if (!client) {
    client = await db.client.create({
      data: {
        fullName: msg.fromName?.trim() || `Клиент ${phone}`,
        phone,
        ownerId: account.ownerId,
        source:  `WhatsApp: ${account.label}`,
      },
    });
  }

  // Найти/создать тред
  let thread = await db.chatThread.findFirst({
    where: {
      channel: 'WHATSAPP',
      whatsappAccountId: account.id,
      OR: [
        { externalPhoneNumber: phone },
        { clientId: client.id },
      ],
    },
  });

  if (!thread) {
    thread = await db.chatThread.create({
      data: {
        channel: 'WHATSAPP',
        clientId: client.id,
        whatsappAccountId: account.id,
        externalPhoneNumber: phone,
        externalUserName: msg.fromName ?? null,
      },
    });
  }

  // Создать сообщение
  const messageType = msg.type === 'text' ? 'TEXT'
    : msg.type === 'image' ? 'IMAGE'
    : msg.type === 'document' ? 'DOCUMENT'
    : msg.type === 'audio' ? 'AUDIO'
    : msg.type === 'video' ? 'VIDEO'
    : msg.type === 'location' ? 'LOCATION'
    : msg.type === 'contact' ? 'CONTACT'
    : 'TEXT';

  await db.$transaction([
    db.chatMessage.create({
      data: {
        threadId:          thread.id,
        whatsappAccountId: account.id,
        direction:         'IN',
        type:              messageType,
        body:              msg.body ?? null,
        mediaUrl:          msg.mediaUrl ?? null,
        mediaName:         msg.mediaName ?? null,
        mediaSize:         msg.mediaSize ?? null,
        externalId:        msg.externalId,
        createdAt:         new Date(msg.timestamp),
      },
    }),
    db.chatThread.update({
      where: { id: thread.id },
      data: {
        lastMessageAt:   new Date(msg.timestamp),
        lastMessageText: msg.body?.slice(0, 200) ?? `[${msg.type}]`,
        unreadCount:     { increment: 1 },
      },
    }),
  ]);

  // Уведомление + push владельцу канала (если есть)
  if (account.ownerId) {
    await notify({
      userId: account.ownerId,
      kind:   'NEW_MESSAGE',
      title:  `Новое сообщение от ${msg.fromName || phone}`,
      body:   msg.body?.slice(0, 100),
      link:   `/inbox?thread=${thread.id}`,
    });
  }

  revalidatePath('/inbox');
  return NextResponse.json({ ok: true });
}

async function handleMessageStatus(s: MessageStatus) {
  const updates: Record<string, Date | boolean> = {};
  const now = new Date();
  if (s.status === 'delivered') updates.deliveredAt = now;
  if (s.status === 'read')      { updates.readAt = now; updates.isRead = true; }

  await db.chatMessage.updateMany({
    where: { externalId: s.externalId, whatsappAccountId: s.accountId },
    data:  updates as never,
  });

  return NextResponse.json({ ok: true });
}

async function handleConnection(c: ConnectionEvent) {
  await db.whatsappAccount.update({
    where: { id: c.accountId },
    data: {
      isConnected: c.status === 'ready',
      lastSeenAt:  c.status === 'ready' ? new Date() : undefined,
    },
  });

  revalidatePath('/settings/channels');
  return NextResponse.json({ ok: true });
}
