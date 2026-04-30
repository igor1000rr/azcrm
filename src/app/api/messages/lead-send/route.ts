// POST /api/messages/lead-send
//
// Универсальный endpoint отправки сообщения из карточки лида —
// роутит по `kind` канала (WHATSAPP/TELEGRAM/VIBER/MESSENGER/INSTAGRAM).
//
// Заменяет /api/whatsapp/lead-send — WhatsApp обрабатывается через тот же
// worker как раньше, остальные каналы — через server actions.
//
// Request:  { leadId, kind: ChannelKind, accountId, body, mediaUrl? }
// Response: { ok: boolean, error?: string }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { whatsappAccountFilter, canViewLead } from '@/lib/permissions';
import { checkRateLimit } from '@/lib/rate-limit';
import { workerSendMessage } from '@/lib/whatsapp';
import { sendMessage as sendTelegramMessage } from '@/lib/telegram';
import { sendViberText } from '@/lib/viber';
import { sendMessengerText, sendInstagramText } from '@/lib/meta';
import { revalidatePath } from 'next/cache';

const SEND_MAX       = 30;
const SEND_WINDOW_MS = 60 * 1000;

type ChannelKindStr = 'WHATSAPP' | 'TELEGRAM' | 'VIBER' | 'MESSENGER' | 'INSTAGRAM';

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!checkRateLimit(`msg-send:${user.id}`, SEND_MAX, SEND_WINDOW_MS)) {
      return NextResponse.json({ ok: false, error: 'Слишком много сообщений. Подождите минуту.' }, { status: 429 });
    }

    const payload = await req.json().catch(() => ({}));
    const { leadId, kind, accountId, body: msgBody, mediaUrl } = payload as {
      leadId?: string; kind?: ChannelKindStr; accountId?: string; body?: string; mediaUrl?: string;
    };

    if (!leadId || !kind || !accountId || !msgBody?.trim()) {
      return NextResponse.json({ ok: false, error: 'leadId/kind/accountId/body обязательны' }, { status: 400 });
    }

    const lead = await db.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true, clientId: true,
        salesManagerId: true, legalManagerId: true,
        client: { select: { id: true, phone: true } },
      },
    });
    if (!lead) return NextResponse.json({ ok: false, error: 'Лид не найден' }, { status: 404 });
    if (!canViewLead(user, lead)) {
      return NextResponse.json({ ok: false, error: 'Нет доступа к лиду' }, { status: 403 });
    }

    // Роутим по типу канала
    switch (kind) {
      case 'WHATSAPP': return await sendWa({ user, lead, accountId, msgBody, mediaUrl });
      case 'TELEGRAM': return await sendTg({ user, lead, accountId, msgBody });
      case 'VIBER':    return await sendViber({ user, lead, accountId, msgBody });
      case 'MESSENGER':
      case 'INSTAGRAM': return await sendMeta({ user, lead, accountId, msgBody, channel: kind });
      default:
        return NextResponse.json({ ok: false, error: `Канал ${kind} не поддерживается` }, { status: 400 });
    }
  } catch (e) {
    const status = (e as Error & { statusCode?: number }).statusCode ?? 500;
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status });
  }
}

// ============ WHATSAPP ============

async function sendWa({
  user, lead, accountId, msgBody, mediaUrl,
}: {
  user: { id: string; role: string };
  lead: { id: string; clientId: string; salesManagerId: string | null; legalManagerId: string | null; client: { phone: string | null } };
  accountId: string;
  msgBody: string;
  mediaUrl?: string;
}) {
  if (!lead.client.phone) {
    return NextResponse.json({ ok: false, error: 'У клиента нет номера телефона' }, { status: 400 });
  }
  const account = await db.whatsappAccount.findFirst({
    where: { id: accountId, isActive: true, ...whatsappAccountFilter(user as Parameters<typeof whatsappAccountFilter>[0]) },
  });
  if (!account)             return NextResponse.json({ ok: false, error: 'Канал недоступен' }, { status: 403 });
  if (!account.isConnected) return NextResponse.json({ ok: false, error: `Канал «${account.label}» не подключён` }, { status: 400 });

  let thread = await db.chatThread.findFirst({
    where: { clientId: lead.clientId, whatsappAccountId: account.id, channel: 'WHATSAPP' },
    select: { id: true },
  });
  if (!thread) {
    thread = await db.chatThread.create({
      data: {
        channel: 'WHATSAPP', clientId: lead.clientId, whatsappAccountId: account.id,
        externalPhoneNumber: lead.client.phone.replace(/^\+/, ''),
      },
      select: { id: true },
    });
  }

  const result = await workerSendMessage(account.id, lead.client.phone, msgBody, mediaUrl);
  if (result.ok) {
    await db.$transaction([
      db.chatMessage.create({
        data: {
          threadId: thread.id, whatsappAccountId: account.id,
          direction: 'OUT', type: mediaUrl ? 'DOCUMENT' : 'TEXT',
          body: msgBody, mediaUrl: mediaUrl ?? null,
          externalId: result.messageId ?? null, senderId: user.id,
        },
      }),
      db.chatThread.update({
        where: { id: thread.id },
        data: { lastMessageAt: new Date(), lastMessageText: msgBody.slice(0, 200) },
      }),
    ]);
    revalidatePath(`/clients/${lead.id}`);
    revalidatePath('/inbox');
  }
  return NextResponse.json(result);
}

// ============ TELEGRAM ============

async function sendTg({
  user, lead, accountId, msgBody,
}: {
  user: { id: string };
  lead: { id: string; clientId: string };
  accountId: string;
  msgBody: string;
}) {
  const account = await db.telegramAccount.findFirst({
    where: { id: accountId, isActive: true },
    select: { id: true, botToken: true, isConnected: true, label: true },
  });
  if (!account)             return NextResponse.json({ ok: false, error: 'Канал недоступен' }, { status: 403 });
  if (!account.isConnected) return NextResponse.json({ ok: false, error: `Канал «${account.label}» не подключён` }, { status: 400 });

  const thread = await db.chatThread.findFirst({
    where: { clientId: lead.clientId, telegramAccountId: account.id, channel: 'TELEGRAM' },
    select: { id: true, externalId: true },
  });
  if (!thread || !thread.externalId) {
    return NextResponse.json({ ok: false, error: 'Клиент ещё не писал в Telegram' }, { status: 400 });
  }

  const sent = await sendTelegramMessage(account.botToken, thread.externalId, msgBody);
  await db.$transaction([
    db.chatMessage.create({
      data: {
        threadId: thread.id, telegramAccountId: account.id,
        direction: 'OUT', type: 'TEXT', body: msgBody,
        externalId: `${sent.message_id}`, senderId: user.id,
        createdAt: new Date(sent.date * 1000),
      },
    }),
    db.chatThread.update({
      where: { id: thread.id },
      data: { lastMessageAt: new Date(), lastMessageText: msgBody.slice(0, 200) },
    }),
  ]);
  revalidatePath(`/clients/${lead.id}`);
  revalidatePath('/inbox');
  return NextResponse.json({ ok: true });
}

// ============ VIBER ============

async function sendViber({
  user, lead, accountId, msgBody,
}: {
  user: { id: string };
  lead: { id: string; clientId: string };
  accountId: string;
  msgBody: string;
}) {
  const account = await db.viberAccount.findFirst({ where: { id: accountId, isActive: true } });
  if (!account)             return NextResponse.json({ ok: false, error: 'Канал недоступен' }, { status: 403 });
  if (!account.isConnected) return NextResponse.json({ ok: false, error: `Канал «${account.label}» не подключён` }, { status: 400 });

  const thread = await db.chatThread.findFirst({
    where: { clientId: lead.clientId, viberAccountId: account.id, channel: 'VIBER' },
    select: { id: true, externalId: true },
  });
  if (!thread || !thread.externalId) {
    return NextResponse.json({ ok: false, error: 'Клиент ещё не писал в Viber' }, { status: 400 });
  }

  const res = await sendViberText(account, thread.externalId, msgBody);
  if (res.status !== 0) {
    return NextResponse.json({ ok: false, error: `Viber отверг: ${res.status_message}` }, { status: 400 });
  }
  await db.$transaction([
    db.chatMessage.create({
      data: {
        threadId: thread.id, viberAccountId: account.id,
        direction: 'OUT', type: 'TEXT', body: msgBody,
        externalId: res.message_token ? String(res.message_token) : null,
        senderId: user.id,
      },
    }),
    db.chatThread.update({
      where: { id: thread.id },
      data: { lastMessageAt: new Date(), lastMessageText: msgBody.slice(0, 200) },
    }),
  ]);
  revalidatePath(`/clients/${lead.id}`);
  revalidatePath('/inbox');
  return NextResponse.json({ ok: true });
}

// ============ META (Messenger / Instagram) ============

async function sendMeta({
  user, lead, accountId, msgBody, channel,
}: {
  user: { id: string };
  lead: { id: string; clientId: string };
  accountId: string;
  msgBody: string;
  channel: 'MESSENGER' | 'INSTAGRAM';
}) {
  const account = await db.metaAccount.findFirst({ where: { id: accountId, isActive: true } });
  if (!account)             return NextResponse.json({ ok: false, error: 'Канал недоступен' }, { status: 403 });
  if (!account.isConnected) return NextResponse.json({ ok: false, error: `Канал «${account.label}» не подключён` }, { status: 400 });

  if (channel === 'INSTAGRAM' && !account.hasInstagram) {
    return NextResponse.json({ ok: false, error: 'Instagram не подключён к этой Page' }, { status: 400 });
  }

  const thread = await db.chatThread.findFirst({
    where: { clientId: lead.clientId, metaAccountId: account.id, channel },
    select: { id: true, externalId: true },
  });
  if (!thread || !thread.externalId) {
    return NextResponse.json({ ok: false, error: `Клиент ещё не писал в ${channel === 'INSTAGRAM' ? 'Instagram' : 'Messenger'}` }, { status: 400 });
  }

  const send = channel === 'INSTAGRAM' ? sendInstagramText : sendMessengerText;
  const res  = await send(account, thread.externalId, msgBody);
  if (res.error) {
    return NextResponse.json({ ok: false, error: `Meta отверг: ${res.error.message}` }, { status: 400 });
  }
  await db.$transaction([
    db.chatMessage.create({
      data: {
        threadId: thread.id, metaAccountId: account.id,
        direction: 'OUT', type: 'TEXT', body: msgBody,
        externalId: res.message_id ?? null, senderId: user.id,
      },
    }),
    db.chatThread.update({
      where: { id: thread.id },
      data: { lastMessageAt: new Date(), lastMessageText: msgBody.slice(0, 200) },
    }),
  ]);
  revalidatePath(`/clients/${lead.id}`);
  revalidatePath('/inbox');
  return NextResponse.json({ ok: true });
}
