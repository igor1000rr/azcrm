// API для управления WhatsApp каналами
// POST /api/whatsapp/connect    { accountId } -> { qr, status }
// POST /api/whatsapp/disconnect { accountId } -> { ok }
// POST /api/whatsapp/send       { accountId, threadId, body } -> { ok, messageId }
//
// Эти endpoints вызываются из UI, проксируют в worker и обновляют БД.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { whatsappAccountFilter } from '@/lib/permissions';
import {
  workerConnect, workerDisconnect, workerSendMessage, workerStatus,
} from '@/lib/whatsapp';
import { revalidatePath } from 'next/cache';

const ACTIONS = ['connect', 'disconnect', 'send', 'status'] as const;
type Action = typeof ACTIONS[number];

export async function POST(
  req:    NextRequest,
  ctx:    { params: Promise<{ action: string }> },
) {
  try {
    const user = await requireUser();
    const { action } = await ctx.params;

    if (!ACTIONS.includes(action as Action)) {
      return NextResponse.json({ error: 'unknown action' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const accountId = body.accountId as string;
    if (!accountId) {
      return NextResponse.json({ error: 'accountId required' }, { status: 400 });
    }

    // Проверяем что юзер имеет доступ к этому аккаунту
    const account = await db.whatsappAccount.findFirst({
      where: { id: accountId, ...whatsappAccountFilter(user) },
    });
    if (!account) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    switch (action) {
      case 'connect': {
        const res = await workerConnect(accountId);
        // Worker может сразу вернуть QR — фронт его покажет
        return NextResponse.json(res);
      }
      case 'disconnect': {
        const res = await workerDisconnect(accountId);
        await db.whatsappAccount.update({
          where: { id: accountId },
          data:  { isConnected: false },
        });
        revalidatePath('/settings/channels');
        return NextResponse.json(res);
      }
      case 'status': {
        const res = await workerStatus(accountId);
        return NextResponse.json(res);
      }
      case 'send': {
        const { threadId, body: msgBody, mediaUrl } = body;
        if (!threadId || !msgBody) {
          return NextResponse.json({ error: 'threadId and body required' }, { status: 400 });
        }

        const thread = await db.chatThread.findUnique({
          where: { id: threadId },
          select: {
            id: true, externalPhoneNumber: true, clientId: true,
            client: { select: { phone: true } },
          },
        });
        if (!thread) {
          return NextResponse.json({ error: 'thread not found' }, { status: 404 });
        }
        const toPhone = thread.externalPhoneNumber || thread.client?.phone;
        if (!toPhone) {
          return NextResponse.json({ error: 'no destination phone' }, { status: 400 });
        }

        const result = await workerSendMessage(accountId, toPhone, msgBody, mediaUrl);

        if (result.ok) {
          await db.$transaction([
            db.chatMessage.create({
              data: {
                threadId,
                whatsappAccountId: accountId,
                direction:    'OUT',
                type:         mediaUrl ? 'DOCUMENT' : 'TEXT',
                body:         msgBody,
                mediaUrl:     mediaUrl ?? null,
                externalId:   result.messageId ?? null,
                senderId:     user.id,
                deliveredAt:  null,  // обновится через webhook
              },
            }),
            db.chatThread.update({
              where: { id: threadId },
              data: {
                lastMessageAt:   new Date(),
                lastMessageText: msgBody.slice(0, 200),
              },
            }),
          ]);
          revalidatePath('/inbox');
        }

        return NextResponse.json(result);
      }
    }
  } catch (e) {
    const status = (e as Error & { statusCode?: number }).statusCode ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
