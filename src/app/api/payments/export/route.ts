// GET /api/payments/export?period=7d|30d|90d|all
//
// CSV-выгрузка платежей для Excel. Доступна только ADMIN и LEGAL.
// SALES не должен иметь возможности массово выгружать финансы
// (ограничение такое же как в UI на /payments).
//
// 06.05.2026 — пункт #62 аудита: кнопка «Excel» на /payments была
// мёртвой (<Button> без onClick/href). Реализую endpoint, кнопка
// превращается в рабочую <Link> в параллельном коммите.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { leadVisibilityFilter } from '@/lib/permissions';
import { buildCsv } from '@/lib/finance/csv';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const user = await requireUser();

  if (user.role !== 'ADMIN' && user.role !== 'LEGAL') {
    return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 });
  }

  const period = (req.nextUrl.searchParams.get('period') ?? '30d') as '7d' | '30d' | '90d' | 'all';
  const since = period === 'all'
    ? null
    : new Date(Date.now() - ({ '7d': 7, '30d': 30, '90d': 90 } as const)[period] * 86400_000);

  const where = {
    lead: leadVisibilityFilter(user),
    ...(since ? { paidAt: { gte: since } } : {}),
  };

  const payments = await db.payment.findMany({
    where,
    orderBy: { paidAt: 'desc' },
    take: 5000,
    include: {
      lead: {
        select: {
          id: true,
          totalAmount: true,
          client:  { select: { fullName: true, phone: true } },
          funnel:  { select: { name: true } },
          service: { select: { name: true } },
          salesManager: { select: { name: true } },
          legalManager: { select: { name: true } },
        },
      },
      createdBy: { select: { name: true } },
    },
  });

  const methodLabel = (m: string) => (
    { CARD: 'Карта', CASH: 'Наличные', TRANSFER: 'Перевод', OTHER: 'Другое' }[m] ?? m
  );

  const headers = [
    'Дата', 'Клиент', 'Телефон', 'Воронка', 'Услуга',
    'Сумма', 'Способ', 'Продажи', 'Легализация', 'Создал',
    'Общая сумма лида', 'Страница лида',
  ];

  const rows = payments.map((p) => [
    p.paidAt.toLocaleDateString('ru-RU', { timeZone: 'Europe/Warsaw' }),
    p.lead.client.fullName,
    p.lead.client.phone ?? '',
    p.lead.funnel.name,
    p.lead.service?.name ?? '',
    Number(p.amount).toFixed(2),
    methodLabel(p.method),
    p.lead.salesManager?.name ?? '',
    p.lead.legalManager?.name ?? '',
    p.createdBy?.name ?? '',
    Number(p.lead.totalAmount).toFixed(2),
    `/clients/${p.lead.id}`,
  ]);

  const csv = buildCsv(headers, rows);

  // Имя файла с текущей датой в ISO формате (Anna просила чтобы по имени
  // было понятно когда выгружено — в русском формате будет путаница с временем).
  const today = new Date().toISOString().slice(0, 10);
  const filename = `payments_${period}_${today}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type':         'text/csv; charset=utf-8',
      'Content-Disposition':  `attachment; filename="${filename}"`,
      'Cache-Control':        'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
