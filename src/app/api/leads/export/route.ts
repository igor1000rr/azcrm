// GET /api/leads/export — экспорт лидов в CSV
// Только ADMIN. С учётом текущих фильтров (funnel, city, sourceKind, дата).
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

const SOURCE_LABELS: Record<string, string> = {
  WHATSAPP: 'WhatsApp', PHONE: 'Телефон', TELEGRAM: 'Telegram', EMAIL: 'Email',
  WEBSITE: 'Сайт', REFERRAL: 'Рекомендация', WALK_IN: 'Самообращение',
  MANUAL: 'Вручную', IMPORT: 'Импорт', OTHER: 'Другое',
};

export async function GET(req: NextRequest) {
  await requireAdmin();
  const { searchParams } = new URL(req.url);
  const funnelId = searchParams.get('funnel');
  const cityId = searchParams.get('city');
  const sourceKind = searchParams.get('sourceKind');
  const archived = searchParams.get('archived') === '1';

  const where = {
    ...(funnelId ? { funnelId } : {}),
    ...(cityId ? { cityId } : {}),
    ...(sourceKind ? { sourceKind: sourceKind as 'WHATSAPP' } : {}),
    isArchived: archived,
  };

  const leads = await db.lead.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 10000,
    include: {
      client:       { select: { fullName: true, phone: true, email: true, nationality: true } },
      funnel:       { select: { name: true } },
      stage:        { select: { name: true } },
      city:         { select: { name: true } },
      service:      { select: { name: true } },
      salesManager: { select: { name: true } },
      legalManager: { select: { name: true } },
      payments:     { select: { amount: true } },
    },
  });

  const headers = [
    'ID', 'Создан', 'ФИО клиента', 'Телефон', 'Email', 'Гражданство',
    'Воронка', 'Этап', 'Город', 'Услуга', 'Источник',
    'Менеджер продаж', 'Менеджер легализации',
    'Стоимость', 'Оплачено', 'Долг',
    'Дата отпечатков', 'Архив',
  ];

  const rows = leads.map((l) => {
    const paid = l.payments.reduce((s, p) => s + Number(p.amount), 0);
    const total = Number(l.totalAmount);
    return [
      l.id,
      l.createdAt.toISOString().slice(0, 19).replace('T', ' '),
      l.client.fullName,
      l.client.phone,
      l.client.email ?? '',
      l.client.nationality ?? '',
      l.funnel.name,
      l.stage.name,
      l.city?.name ?? '',
      l.service?.name ?? '',
      l.sourceKind ? (SOURCE_LABELS[l.sourceKind] ?? l.sourceKind) : (l.source ?? ''),
      l.salesManager?.name ?? '',
      l.legalManager?.name ?? '',
      total.toFixed(2),
      paid.toFixed(2),
      Math.max(0, total - paid).toFixed(2),
      l.fingerprintDate ? l.fingerprintDate.toISOString().slice(0, 10) : '',
      l.isArchived ? 'да' : 'нет',
    ];
  });

  const escape = (s: string | number) => {
    const v = String(s ?? '');
    if (v.includes(';') || v.includes('"') || v.includes('\n')) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  };

  // BOM для Excel + ; разделитель (русская локаль Excel)
  const csv = '\uFEFF' + [headers, ...rows].map((r) => r.map(escape).join(';')).join('\r\n');

  const filename = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
