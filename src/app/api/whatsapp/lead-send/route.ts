// POST /api/whatsapp/lead-send
//
// Отправка WhatsApp-сообщения из карточки лида.
//
// Отличие от /api/whatsapp/send:
//   - принимает leadId + accountId, а не threadId
//   - сам находит/создаёт ChatThread для (clientId, accountId)
//   - проверяет права на канал через whatsappAccountFilter
//     (ADMIN — все, остальные — свои + общие)
//
// Request:  { leadId: string, accountId: string, body: string, mediaUrl?: string }
// Response: { ok: boolean, messageId?: string, error?: string }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { whatsappAccountFilter, canViewLead } from '@/lib/permissions';
import { checkRateLimit } from '@/lib/rate-limit';
import { workerSendMessage } from '@/lib/whatsapp';
import { revalidatePath } from 'next/cache';

const SEND_MAX       = 30;
const SEND_WINDOW_MS = 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();

    if (!checkRateLimit(`wa-send:${user.id}`, SEND_MAX, SEND_WINDOW_MS)) {
      return NextResponse.json(
        { ok: false, error: 'Слишком много сообщений. Подождите минуту.' },
        { status: 429 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const { leadId, accountId, body: msgBody, mediaUrl } = body as {
      leadId?: string; accountId?: string; body?: string; mediaUrl?: string;
    };

    if (!leadId || !accountId || !msgBody?.trim()) {
      return NextResponse.json(
        { ok: false, error: 'leadId, accountId и body обязательны' },
        { status: 400 },
      );
    }

    // Лид + право на просмотр
    const lead = await db.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true, clientId: true,
        salesManagerId: true, legalManagerId: true,
        client: { select: { id: true, phone: true } },
      },
    });
    if (!lead) {
      return NextResponse.json({ ok: false, error: 'Лид не найден' }, { status: 404 });
    }
    if (!canViewLead(user, lead)) {
      return NextResponse.json({ ok: false, error: 'Нет доступа к лиду' }, { status: 403 });
    }
    if (!lead.client.phone) {
      return NextResponse.json(
        { ok: false, error: 'У клиента нет номера телефона' },
        { status: 400 },
      );
    }

    // Канал + право на отправку с него
    const account = await db.whatsappAccount.findFirst({
      where: { id: accountId, isActive: true, ...whatsappAccountFilter(user) },
    });
    if (!account) {
      return NextResponse.json(
        { ok: false, error: 'Канал недоступен или не подключён' },
        { status: 403 },
      );
    }
    if (!account.isConnected) {
      return NextResponse.json(
        { ok: false, error: `Канал «${account.label}» сейчас не подключён` },
        { status: 400 },
      );
    }

    // Находим или создаём ChatThread для (clientId, accountId).
    // Один клиент может иметь по треду на каждый канал — это нормально:
    // в карточке мы их объединяем, но в БД тред привязан к одной паре.
    let thread = await db.chatThread.findFirst({
      where: {
        clientId:          lead.clientId,
        whatsappAccountId: account.id,
        channel:           'WHATSAPP',
      },
      select: { id: true },
    });
    if (!thread) {
      thread = await db.chatThread.create({
        data: {
          channel:             'WHATSAPP',
          clientId:            lead.clientId,
          whatsappAccountId:   account.id,
          externalPhoneNumber: lead.client.phone.replace(/^\+/, ''),
        },
        select: { id: true },
      });
    }

    // Отправка через worker
    const result = await workerSendMessage(account.id, lead.client.phone, msgBody, mediaUrl);

    if (result.ok) {
      await db.$transaction([
        db.chatMessage.create({
          data: {
            threadId:          thread.id,
            whatsappAccountId: account.id,
            direction:         'OUT',
            type:              mediaUrl ? 'DOCUMENT' : 'TEXT',
            body:              msgBody,
            mediaUrl:          mediaUrl ?? null,
            externalId:        result.messageId ?? null,
            senderId:          user.id,
          },
        }),
        db.chatThread.update({
          where: { id: thread.id },
          data: {
            lastMessageAt:   new Date(),
            lastMessageText: msgBody.slice(0, 200),
          },
        }),
      ]);
      revalidatePath(`/clients/${leadId}`);
      revalidatePath('/inbox');
    }

    return NextResponse.json(result);
  } catch (e) {
    const status = (e as Error & { statusCode?: number }).statusCode ?? 500;
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status });
  }
}
