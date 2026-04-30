// Webhook для Viber Bot API.
// URL: https://crm.azgroupcompany.net/api/viber/webhook?account=<viberAccountId>
//
// Параметр account=<id> в URL — чтобы знать какой ViberAccount получил событие
// (если у фирмы несколько Viber Public Accounts, у каждого свой webhook URL
// отличается этим параметром).
//
// Подпись X-Viber-Content-Signature = HMAC-SHA256(authToken, raw body).
// КРИТИЧНО: проверять сырое тело ДО парсинга JSON — иначе подпись не сойдётся.

import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { verifyViberSignature, handleViberEvent, type ViberEvent } from '@/lib/viber';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
// Чтобы Next не кэшировал ответы webhook — каждый запрос обрабатывается заново
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // 1. Идентификация аккаунта
  const accountId = req.nextUrl.searchParams.get('account');
  if (!accountId) {
    return NextResponse.json({ error: 'missing account param' }, { status: 400 });
  }

  const account = await db.viberAccount.findUnique({ where: { id: accountId } });
  if (!account || !account.isActive) {
    return NextResponse.json({ error: 'account not found' }, { status: 404 });
  }

  // 2. Сырое тело + проверка подписи
  const rawBody  = await req.text();
  const sig      = req.headers.get('x-viber-content-signature') ?? '';

  if (!verifyViberSignature(account.authToken, rawBody, sig)) {
    logger.warn(`[viber] bad signature for account ${accountId}`);
    return NextResponse.json({ error: 'bad signature' }, { status: 401 });
  }

  // 3. Парсинг и обработка
  let event: ViberEvent;
  try { event = JSON.parse(rawBody) as ViberEvent; }
  catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }

  // Viber требует ответить 200 за <= 8 секунд иначе ретраит. Поэтому
  // обработка лёгкая — только запись в БД, тяжёлые операции (если будут)
  // нужно выносить в очередь.
  try {
    const result = await handleViberEvent(account, event);
    return NextResponse.json({ status: 0, status_message: 'ok', ...result });
  } catch (err) {
    logger.error('[viber] handler error', err);
    // Возвращаем 200 чтобы Viber не ретраил — событие в логах, разберёмся
    return NextResponse.json({ status: 0, status_message: 'logged' });
  }
}

// Viber не дёргает GET, но Next требует обработчик — пусть будет 405
export async function GET() {
  return NextResponse.json({ error: 'method not allowed' }, { status: 405 });
}
