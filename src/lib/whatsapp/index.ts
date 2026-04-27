// Клиент к whatsapp-worker процессу.
// Worker — отдельный Node.js процесс, держащий puppeteer-сессии WhatsApp Web.
//
// API worker'а (внутренний, по WORKER_API_URL):
//   POST /accounts/:id/connect   — старт сессии, возвращает QR код
//   POST /accounts/:id/disconnect — отключить
//   GET  /accounts/:id/status    — статус
//   POST /accounts/:id/send      — отправить сообщение
//
// Worker дёргает наш CRM при событиях:
//   POST /api/whatsapp/webhook   — { kind, accountId, ...data }

import crypto from 'node:crypto';

const WORKER_URL = process.env.WHATSAPP_WORKER_URL ?? 'http://localhost:3100';
const WORKER_AUTH_TOKEN = process.env.WHATSAPP_WORKER_TOKEN ?? '';

interface ConnectResult {
  qr?:        string;     // base64 QR-кода (если требуется сканирование)
  status:     'qr' | 'authenticating' | 'ready' | 'failed';
  phoneNumber?: string;   // подтверждённый номер после ready
  error?:     string;
}

interface SendResult {
  ok:        boolean;
  messageId?: string;
  error?:    string;
}

interface AccountStatus {
  status: 'disconnected' | 'qr' | 'authenticating' | 'ready' | 'failed';
  phoneNumber?: string;
  lastSeenAt?: string;
  qr?: string;
}

/** Запросить QR / подключиться к WhatsApp */
export async function workerConnect(accountId: string): Promise<ConnectResult> {
  return workerCall<ConnectResult>('POST', `/accounts/${accountId}/connect`);
}

/** Отключить аккаунт */
export async function workerDisconnect(accountId: string): Promise<{ ok: boolean }> {
  return workerCall<{ ok: boolean }>('POST', `/accounts/${accountId}/disconnect`);
}

/** Получить текущий статус аккаунта */
export async function workerStatus(accountId: string): Promise<AccountStatus> {
  return workerCall<AccountStatus>('GET', `/accounts/${accountId}/status`);
}

/** Отправить сообщение */
export async function workerSendMessage(
  accountId: string,
  toPhone:   string,        // полный международный формат
  body:      string,
  mediaUrl?: string,
): Promise<SendResult> {
  return workerCall<SendResult>('POST', `/accounts/${accountId}/send`, {
    to:    toPhone,
    body,
    mediaUrl,
  });
}

async function workerCall<T>(
  method: 'GET' | 'POST',
  path:   string,
  body?:  unknown,
): Promise<T> {
  try {
    const res = await fetch(`${WORKER_URL}${path}`, {
      method,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${WORKER_AUTH_TOKEN}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`WhatsApp worker error: ${res.status} ${text}`);
    }
    return res.json() as Promise<T>;
  } catch (e) {
    // Worker может быть не запущен — возвращаем дефолт
    if ((e as Error).message.includes('fetch failed')) {
      throw new Error('WhatsApp worker недоступен. Проверьте что процесс запущен.');
    }
    throw e;
  }
}

/**
 * Проверка валидности webhook'a от worker'а.
 * Если токен не настроен — отказ ВО ВСЕХ запросах. Иначе любой может
 * слать фейковые входящие сообщения и плодить лиды/клиентов.
 * Сравниваем через timingSafeEqual чтобы не сливать длину токена.
 */
export function verifyWebhookToken(token: string | null): boolean {
  if (!WORKER_AUTH_TOKEN) return false;
  if (!token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(WORKER_AUTH_TOKEN);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
