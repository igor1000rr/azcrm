// GET /api/payments/export — экспорт платежей в CSV.
//
// Доступ: ADMIN или LEGAL (как в UI страницы /payments).
// SALES не должен массово выгружать финансы.
//
// Принимает ?period=7d|30d|90d|all (дефолт 30d) — тот же фильтр что в UI.
// Применяет leadVisibilityFilter (LEGAL видит только свои лиды).
//
// 06.05.2026 — пункт #62 аудита: раньше кнопка «Excel» на /payments была
// mock'ом без реализации. Теперь она ведёт сюда.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { leadVisibilityFilter } from '@/lib/permissions';
import { buildCsv } from '@/lib/finance/csv';

const METHOD_LABELS: Record<string, string> = {
  CARD: 'Карта', CASH: 'Наличные', TRANSFER: 'Перевод', OTHER: 'Другое',
};

export async function GET(req: NextRequest) {
  const user = await requireUser();

  // Разрешаем только ADMIN и LEGAL (как в UI). SALES — 403.
  if (user.role !== 'ADMIN' && user.role !== 'LEGAL') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const period = (searchParams.get('period') ?? '30d') as '7d' | '30d' | '90d' | 'all';

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
    take: 10000,
    include: {
      lead: {
        include: {
          client: { select: { fullName: true, phone: true } },
          funnel: { select: { name: true } },
          service: { select: { name: true } },
        },
      },
      createdBy: { select: { name: true } },
    },
  });

  const headers = [
    'Дата', 'Клиент', 'Телефон', 'Воронка', 'Услуга',
    'Способ', 'Сумма', 'Номер платежа', 'Менеджер', 'Комментарий',
  ];

  const rows = payments.map((p) => [
    p.paidAt.toISOString().slice(0, 19).replace('T', ' '),
    p.lead.client.fullName,
    p.lead.client.phone,
    p.lead.funnel.name,
    p.lead.service?.name ?? '',
    METHOD_LABELS[p.method] ?? p.method,
    Number(p.amount).toFixed(2),
    String(p.sequence),
    p.createdBy?.name ?? '',
    p.notes ?? '',
  ]);

  const csv = buildCsv(headers, rows);

  const filename = `payments-${period}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
