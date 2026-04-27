// POST /api/chat-templates/render
// Принимает { templateId, threadId } и возвращает { body } с подстановкой полей.
//
// Поддерживаемые плейсхолдеры:
//   {client.fullName}
//   {lead.fingerprintDate} {lead.fingerprintTime} {lead.fingerprintLocation}
//   {lead.debt} {lead.totalAmount} {lead.paid}
//   {user.name} (отправитель — текущий юзер)
//   {today}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { whatsappAccountFilter } from '@/lib/permissions';
import { formatDate, formatTime, formatMoney } from '@/lib/utils';

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const { templateId, threadId } = await req.json() as { templateId: string; threadId: string };

    if (!templateId || !threadId) {
      return NextResponse.json({ error: 'templateId and threadId required' }, { status: 400 });
    }

    const tpl = await db.chatTemplate.findUnique({
      where: { id: templateId },
      select: { body: true },
    });
    if (!tpl) return NextResponse.json({ error: 'template not found' }, { status: 404 });

    const thread = await db.chatThread.findFirst({
      where: {
        id: threadId,
        whatsappAccount: whatsappAccountFilter(user),
      },
      include: {
        client: true,
        lead: {
          include: {
            payments: { select: { amount: true } },
          },
        },
      },
    });
    if (!thread) return NextResponse.json({ error: 'thread not found' }, { status: 404 });

    // Контекст для подстановки
    const client = thread.client;
    const lead   = thread.lead;
    const total  = lead ? Number(lead.totalAmount) : 0;
    const paid   = lead ? lead.payments.reduce((s, p) => s + Number(p.amount), 0) : 0;
    const debt   = Math.max(0, total - paid);

    const ctx: Record<string, string> = {
      'today':                    formatDate(new Date()),
      'user.name':                user.name,
      'client.fullName':          client?.fullName ?? thread.externalUserName ?? '',
      'client.phone':             client?.phone ?? thread.externalPhoneNumber ?? '',
      'client.email':             client?.email ?? '',
      'lead.service':             '',
      'lead.fingerprintDate':     lead?.fingerprintDate ? formatDate(lead.fingerprintDate) : '',
      'lead.fingerprintTime':     lead?.fingerprintDate ? formatTime(lead.fingerprintDate) : '',
      'lead.fingerprintLocation': lead?.fingerprintLocation ?? '',
      'lead.totalAmount':         formatMoney(total),
      'lead.paid':                formatMoney(paid),
      'lead.debt':                formatMoney(debt),
    };

    // Замена {key} на значение
    const body = tpl.body.replace(/\{([^}]+)\}/g, (match, key) => {
      const val = ctx[key.trim()];
      return val !== undefined ? val : match;
    });

    return NextResponse.json({ body });
  } catch (e) {
    const status = (e as Error & { statusCode?: number }).statusCode ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
