// Webhook для Meta Graph API (Facebook Messenger + Instagram Direct).
// URL: https://crm.azgroupcompany.net/api/messenger/webhook?account=<metaAccountId>
//
// Один URL обслуживает оба продукта (Messenger + Instagram) — FB сам шлёт
// по одному endpoint'у с object='page' или object='instagram'.
//
// Verify flow (GET): FB при сохранении webhook URL дёргает GET с параметрами
//   ?hub.mode=subscribe&hub.challenge=<random>&hub.verify_token=<token>
// Мы сверяем verify_token с MetaAccount.verifyToken и эхо-возвращаем challenge.
//
// Event flow (POST): FB шлёт payload с подписью X-Hub-Signature-256 (HMAC-SHA256
// от raw body с ключом = App Secret). Проверяем ДО парсинга JSON.
//
// 06.05.2026 — пункт #5 аудита: appSecret хранится в БД зашифрованным.
// Расшифровываем непосредственно перед verifyMetaSignature.
// verifyToken НЕ шифруется (это не секрет, а просто строка для FB верификации).

import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { verifyMetaSignature, handleMetaWebhook, type MetaWebhookPayload } from '@/lib/meta';
import { logger } from '@/lib/logger';
import { decrypt } from '@/lib/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ============ GET — Verify token (FB регистрация webhook) ============

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const accountId = params.get('account');
  const mode      = params.get('hub.mode');
  const token     = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');

  if (!accountId) {
    return NextResponse.json({ error: 'missing account' }, { status: 400 });
  }
  const account = await db.metaAccount.findUnique({ where: { id: accountId } });
  if (!account) {
    return NextResponse.json({ error: 'account not found' }, { status: 404 });
  }

  // verifyToken не зашифрован — простое сравнение
  if (mode === 'subscribe' && token === account.verifyToken && challenge) {
    return new NextResponse(challenge, {
      status:  200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
  return NextResponse.json({ error: 'verify failed' }, { status: 403 });
}

// ============ POST — входящие сообщения ============

export async function POST(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get('account');
  if (!accountId) {
    return NextResponse.json({ error: 'missing account' }, { status: 400 });
  }
  const account = await db.metaAccount.findUnique({ where: { id: accountId } });
  if (!account || !account.isActive) {
    return NextResponse.json({ error: 'account not found' }, { status: 404 });
  }

  const rawBody = await req.text();
  const sig     = req.headers.get('x-hub-signature-256');

  // Расшифровываем appSecret для HMAC проверки
  if (!verifyMetaSignature(decrypt(account.appSecret), rawBody, sig)) {
    logger.warn(`[meta] bad signature for account ${accountId}`);
    return NextResponse.json({ error: 'bad signature' }, { status: 401 });
  }

  let payload: MetaWebhookPayload;
  try { payload = JSON.parse(rawBody) as MetaWebhookPayload; }
  catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }

  try {
    const result = await handleMetaWebhook(payload);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    logger.error('[meta] handler error', err);
    return NextResponse.json({ ok: true, logged: true });
  }
}
