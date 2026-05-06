// Webhook для Viber Bot API.
// URL: https://crm.azgroupcompany.net/api/viber/webhook?account=<viberAccountId>
//
// Параметр account=<id> в URL — чтобы знать какой ViberAccount получил событие
// (если у фирмы несколько Viber Public Accounts, у каждого свой webhook URL
// отличается этим параметром).
//
// Подпись X-Viber-Content-Signature = HMAC-SHA256(authToken, raw body).
// КРИТИЧНО: проверять сырое тело ДО парсинга JSON — иначе подпись не сойдётся.
//
// 06.05.2026 — пункт #5 аудита: authToken хранится в БД зашифрованным,
// расшифровываем непосредственно перед вызовом verifyViberSignature.
// decrypt() безопасен и для legacy plaintext (вернёт как есть).

import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { verifyViberSignature, handleViberEvent, type ViberEvent } from '@/lib/viber';
import { logger } from '@/lib/logger';
import { decrypt } from '@/lib/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get('account');
  if (!accountId) {
    return NextResponse.json({ error: 'missing account param' }, { status: 400 });
  }

  const account = await db.viberAccount.findUnique({ where: { id: accountId } });
  if (!account || !account.isActive) {
    return NextResponse.json({ error: 'account not found' }, { status: 404 });
  }

  const rawBody  = await req.text();
  const sig      = req.headers.get('x-viber-content-signature') ?? '';

  // Расшифровываем токен для проверки подписи
  if (!verifyViberSignature(decrypt(account.authToken), rawBody, sig)) {
    logger.warn(`[viber] bad signature for account ${accountId}`);
    return NextResponse.json({ error: 'bad signature' }, { status: 401 });
  }

  let event: ViberEvent;
  try { event = JSON.parse(rawBody) as ViberEvent; }
  catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }

  // Viber требует ответить 200 за <= 8 секунд иначе ретраит.
  // handleViberEvent внутри сам не использует authToken, поэтому передаём account
  // как есть — encrypted authToken не помешает (handler делает только write в БД).
  try {
    const result = await handleViberEvent(account, event);
    return NextResponse.json({ status: 0, status_message: 'ok', ...result });
  } catch (err) {
    logger.error('[viber] handler error', err);
    return NextResponse.json({ status: 0, status_message: 'logged' });
  }
}

export async function GET() {
  return NextResponse.json({ error: 'method not allowed' }, { status: 405 });
}
