// POST /api/public/leads — приём заявок с публичных лендингов (azgroupcompany.net).
//
// БЕЗОПАСНОСТЬ:
//  1. CORS allowlist — разрешены только наши домены (см. ALLOWED_ORIGINS).
//  2. Rate-limit 5 заявок/час с одного IP.
//  3. Honeypot-поле `_hp` — должно быть пустым; боты обычно его заполняют.
//  4. Zod-валидация всех полей с разумными max.
//  5. Дедупликация по нормализованному phone — повторная заявка с того же
//     номера НЕ создаёт нового клиента, только новый лид (если у клиента нет
//     активного лида) или просто LeadEvent в существующий активный лид.
//
// ЛОГИКА:
//  - Лид падает в первую активную воронку, на первый этап.
//  - Менеджер не назначен (общая очередь). Anna распределяет в UI.
//  - sourceKind = WEBSITE.
//  - Все поля формы (услуга, офис, время) сохраняются в `summary`.
//  - LeadEvent с kind=LEAD_CREATED + payload для аудита.
//  - Уведомление всем активным ADMIN-юзерам через notify() (БД + push + email).

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { normalizePhone } from '@/lib/utils';
import { checkRateLimit } from '@/lib/rate-limit';
import { notify } from '@/lib/notify';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// CORS allowlist — основной домен и оба субдомена для тестирования
const ALLOWED_ORIGINS = new Set([
  'https://azgroupcompany.net',
  'https://www.azgroupcompany.net',
  'http://azgroupcompany.net',
  'http://www.azgroupcompany.net',
]);

const RL_MAX        = 5;
const RL_WINDOW_MS  = 60 * 60 * 1000;  // 1 час

const LeadSchema = z.object({
  name:           z.string().trim().min(2, 'Укажите имя').max(120),
  phone:          z.string().trim().min(5, 'Укажите телефон').max(40),
  service:        z.string().trim().max(120).optional().or(z.literal('')),
  office:         z.string().trim().max(80).optional().or(z.literal('')),
  preferredTime:  z.string().trim().max(120).optional().or(z.literal('')),
  message:        z.string().trim().max(2000).optional().or(z.literal('')),
  // Honeypot — должен быть пустым. Боты автозаполняют все input-поля.
  _hp:            z.string().max(0).optional().or(z.literal('')),
  // Источник — для будущего разделения форм (главная / popup / контакты)
  source:         z.string().trim().max(80).optional().or(z.literal('')),
});

function corsHeaders(origin: string | null): HeadersInit {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://azgroupcompany.net';
  return {
    'Access-Control-Allow-Origin':  allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400',
    'Vary':                          'Origin',
  };
}

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

// ============ OPTIONS — CORS preflight ============

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status:  204,
    headers: corsHeaders(req.headers.get('origin')),
  });
}

// ============ POST — приём заявки ============

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  const headers = corsHeaders(origin);

  // CORS-проверка по Origin: блокируем запросы с чужих сайтов.
  // Прямые curl/Postman запросы (без Origin) пропускаем — они не из браузера
  // и CORS их не защищает в принципе, защита там через rate-limit + honeypot.
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return NextResponse.json({ error: 'origin not allowed' }, { status: 403, headers });
  }

  // Rate-limit по IP
  const ip = getClientIp(req);
  if (!checkRateLimit(`public-leads:${ip}`, RL_MAX, RL_WINDOW_MS)) {
    return NextResponse.json(
      { error: 'Слишком много заявок. Попробуйте позже.' },
      { status: 429, headers },
    );
  }

  // Парсинг + валидация
  let body: z.infer<typeof LeadSchema>;
  try {
    const json = await req.json();
    body = LeadSchema.parse(json);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Проверьте поля формы', issues: e.issues.map((i) => i.message) },
        { status: 400, headers },
      );
    }
    return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400, headers });
  }

  // Honeypot triggered — притворяемся что всё ок (200), но ничего не пишем.
  // Так бот не поймёт что его отшили и не будет варьировать атаку.
  if (body._hp && body._hp.length > 0) {
    logger.warn('[public-leads] honeypot triggered, ip=', ip);
    return NextResponse.json({ ok: true }, { status: 200, headers });
  }

  let phone: string;
  try {
    phone = normalizePhone(body.phone);
  } catch {
    return NextResponse.json(
      { error: 'Неверный формат телефона' },
      { status: 400, headers },
    );
  }

  try {
    // Нужна активная воронка с этапами (не упасть если БД пустая)
    const funnel = await db.funnel.findFirst({
      where:   { isActive: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: { stages: { orderBy: { position: 'asc' }, take: 1 } },
    });
    if (!funnel || funnel.stages.length === 0) {
      logger.error('[public-leads] нет активной воронки с этапами');
      return NextResponse.json(
        { error: 'Сервис временно недоступен' },
        { status: 503, headers },
      );
    }

    // Соберём текстовое представление деталей формы для summary/уведомления
    const detailsParts: string[] = [];
    if (body.service)       detailsParts.push(`Услуга: ${body.service}`);
    if (body.office)        detailsParts.push(`Офис: ${body.office}`);
    if (body.preferredTime) detailsParts.push(`Когда удобно: ${body.preferredTime}`);
    if (body.message)       detailsParts.push(`Сообщение: ${body.message}`);
    const details = detailsParts.join('\n');

    const sourceLabel = `Сайт: azgroupcompany.net${body.source ? ` (${body.source})` : ''}`;

    // Дедуп по телефону. Если клиент уже есть — добавим к нему лид (если нет
    // активного лида) или просто залогируем событие в существующий активный лид.
    const existingClient = await db.client.findUnique({
      where:  { phone },
      select: {
        id: true,
        leads: {
          where:   { isArchived: false },
          orderBy: { updatedAt: 'desc' },
          take:    1,
          select:  { id: true },
        },
      },
    });

    const clientId = existingClient
      ? existingClient.id
      : (await db.client.create({
          data: {
            fullName: body.name,
            phone,
            source:   sourceLabel,
          },
          select: { id: true },
        })).id;

    const leadId = existingClient?.leads[0]?.id ?? null;

    if (leadId) {
      // У клиента уже есть активный лид — повторная заявка через сайт.
      // Создаём событие в истории, лида не дублируем.
      await db.leadEvent.create({
        data: {
          leadId,
          kind:    'CUSTOM',
          message: `Повторная заявка с сайта${details ? '\n' + details : ''}`,
          payload: {
            from:     'website',
            origin:   origin ?? null,
            ip,
            ...body,
            phone,
          },
        },
      });
    } else {
      // Новый лид. Без менеджеров (общая очередь — Anna распределит в UI).
      const created = await db.lead.create({
        data: {
          clientId,
          funnelId:       funnel.id,
          stageId:        funnel.stages[0].id,
          source:         sourceLabel,
          sourceKind:     'WEBSITE',
          firstContactAt: new Date(),
          summary:        details || null,
          events: {
            create: {
              kind:    'LEAD_CREATED',
              message: `Заявка с сайта${details ? '\n' + details : ''}`,
              payload: {
                from:     'website',
                origin:   origin ?? null,
                ip,
                service:  body.service || null,
                office:   body.office || null,
                preferredTime: body.preferredTime || null,
              },
            },
          },
        },
        select: { id: true },
      });

      // Уведомляем всех активных админов (Anna)
      const admins = await db.user.findMany({
        where:  { role: 'ADMIN', isActive: true },
        select: { id: true },
      });
      const titleService = body.service ? ` — ${body.service}` : '';
      for (const a of admins) {
        await notify({
          userId: a.id,
          kind:   'CUSTOM',
          title:  `Новая заявка с сайта: ${body.name}${titleService}`,
          body:   `${phone}${details ? '\n' + details : ''}`,
          link:   `/clients/${created.id}`,
          forceEmail: true,
        }).catch((err) => logger.error('[public-leads] notify admin failed:', err));
      }
    }

    return NextResponse.json({ ok: true }, { status: 200, headers });
  } catch (e) {
    logger.error('[public-leads] failed:', e);
    return NextResponse.json(
      { error: 'Не удалось сохранить заявку. Попробуйте позже или позвоните нам.' },
      { status: 500, headers },
    );
  }
}
