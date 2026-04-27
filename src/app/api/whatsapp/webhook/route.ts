// POST /api/whatsapp/webhook
// Worker вызывает этот endpoint при событиях:
//   - 'message.in'     — входящее сообщение
//   - 'message.status' — статус доставки исходящего
//   - 'connection'     — изменение статуса подключения
//
// Логика для входящих:
//   1. Найти клиента по номеру телефона (нормализованному)
//   2. Если нет — создать нового клиента + лида (по правилу WA-номера)
//   3. Найти/создать ChatThread
//   4. Создать ChatMessage, инкрементить unreadCount
//   5. Обновить lastMessageAt в треде

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyWebhookToken } from '@/lib/whatsapp';
import { normalizePhone } from '@/lib/utils';
import { revalidatePath } from 'next/cache';
import { notify } from '@/lib/notify';

interface IncomingMessage {
  kind:        'message.in';
  accountId:   string;       // WhatsappAccount.id
  externalId:  string;       // WhatsApp message ID (для дедупликации)
  fromPhone:   string;       // номер собеседника
  fromName?:   string;       // имя из WhatsApp профиля
  type:        'text' | 'image' | 'document' | 'audio' | 'video' | 'location' | 'contact';
  body?:       string;
  mediaUrl?:   string;       // URL внутри worker'а — нужно скачать
  mediaName?:  string;
  mediaSize?:  number;
  timestamp:   number;
}

interface ConnectionEvent {
  kind:        'connection';
  accountId:   string;
  status:      'qr' | 'authenticating' | 'ready' | 'disconnected' | 'failed';
  phoneNumber?: string;
}

interface MessageStatus {
  kind:        'message.status';
  accountId:   string;
  externalId:  string;
  status:      'sent' | 'delivered' | 'read' | 'failed';
}

type WebhookBody = IncomingMessage | ConnectionEvent | MessageStatus;

export async function POST(req: NextRequest) {
  // Проверка токена
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!verifyWebhookToken(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json() as WebhookBody;

  switch (body.kind) {
    case 'message.in':
      return handleIncomingMessage(body);
    case 'message.status':
      return handleMessageStatus(body);
    case 'connection':
      return handleConnection(body);
    default:
      return NextResponse.json({ error: 'unknown kind' }, { status: 400 });
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

  // Найти клиента по номеру
  let client = await db.client.findUnique({ where: { phone } });

  // Если клиента нет — создаём + первый лид
  if (!client) {
    // Назначение менеджера: владелец канала, если есть; иначе — без менеджера
    const ownerId = account.ownerId;

    // Берём первую активную воронку как дефолт ("Консультация" обычно)
    const defaultFunnel = await db.funnel.findFirst({
      where: { isActive: true },
      include: { stages: { orderBy: { position: 'asc' }, take: 1 } },
    });

    if (!defaultFunnel || defaultFunnel.stages.length === 0) {
      console.error('[wa-webhook] no default funnel/stage configured');
      return NextResponse.json({ error: 'no funnel configured' }, { status: 500 });
    }

    client = await db.client.create({
      data: {
        fullName:  msg.fromName?.trim() || `Клиент ${phone}`,
        phone,
        ownerId,
        source:    `WhatsApp: ${account.label}`,
      },
    });

    // Создаём первый лид
    await db.lead.create({
      data: {
        clientId:           client.id,
        funnelId:           defaultFunnel.id,
        stageId:            defaultFunnel.stages[0].id,
        salesManagerId:     ownerId,
        whatsappAccountId:  account.id,
        source:             `WhatsApp: ${account.label}`,
        firstContactAt:     new Date(msg.timestamp),
        events: {
          create: {
            authorId: ownerId,
            kind:     'LEAD_CREATED',
            message:  `Лид создан автоматически из WhatsApp (${account.label})`,
          },
        },
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
