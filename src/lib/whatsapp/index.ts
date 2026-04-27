// Клиент к whatsapp-worker процессу.
const WORKER_URL = process.env.WHATSAPP_WORKER_URL ?? 'http://localhost:3100';
const WORKER_AUTH_TOKEN = process.env.WHATSAPP_WORKER_TOKEN ?? '';

interface ConnectResult {
  qr?:        string;
  status:     'qr' | 'authenticating' | 'ready' | 'failed';
  phoneNumber?: string;
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

export async function workerConnect(accountId: string): Promise<ConnectResult> {
  return workerCall<ConnectResult>('POST', `/accounts/${accountId}/connect`);
}

export async function workerDisconnect(accountId: string): Promise<{ ok: boolean }> {
  return workerCall<{ ok: boolean }>('POST', `/accounts/${accountId}/disconnect`);
}

export async function workerStatus(accountId: string): Promise<AccountStatus> {
  return workerCall<AccountStatus>('GET', `/accounts/${accountId}/status`);
}

export async function workerSendMessage(
  accountId: string,
  toPhone:   string,
  body:      string,
  mediaUrl?: string,
): Promise<SendResult> {
  return workerCall<SendResult>('POST', `/accounts/${accountId}/send`, {
    to: toPhone, body, mediaUrl,
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
    if ((e as Error).message.includes('fetch failed')) {
      throw new Error('WhatsApp worker недоступен. Проверьте что процесс запущен.');
    }
    throw e;
  }
}

export function verifyWebhookToken(token: string | null): boolean {
  if (!WORKER_AUTH_TOKEN) return true;
  return token === WORKER_AUTH_TOKEN;
}
