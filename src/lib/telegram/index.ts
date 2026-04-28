// Telegram Bot API client — прямые HTTP-вызовы без grammy/telegraf,
// чтобы не тащить в Next.js лишние зависимости. Telegram работает
// через простой REST: https://api.telegram.org/bot<token>/<method>.
// В отличие от WhatsApp здесь НЕ нужен отдельный worker-процесс —
// пользуемся webhook'ом прямо в Next.js.

import crypto from 'crypto';

const BASE = 'https://api.telegram.org';
const TIMEOUT_MS = 10_000;

export interface TelegramUser {
  id:         number;
  is_bot:     boolean;
  first_name: string;
  last_name?: string;
  username?:  string;
}

export interface TelegramChat {
  id:         number;
  type:       'private' | 'group' | 'supergroup' | 'channel';
  first_name?: string;
  last_name?:  string;
  username?:   string;
  title?:      string;
}

export interface TelegramMessage {
  message_id: number;
  from?:      TelegramUser;
  chat:       TelegramChat;
  date:       number;
  text?:      string;
  caption?:   string;
  photo?:     Array<{ file_id: string; file_unique_id: string; width: number; height: number; file_size?: number }>;
  document?:  { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
  voice?:     { file_id: string; duration: number; mime_type?: string; file_size?: number };
  video?:     { file_id: string; mime_type?: string; file_size?: number };
  audio?:     { file_id: string; mime_type?: string; file_size?: number };
  contact?:   { phone_number: string; first_name: string; last_name?: string };
  location?:  { latitude: number; longitude: number };
}

export interface TelegramUpdate {
  update_id:        number;
  message?:         TelegramMessage;
  edited_message?:  TelegramMessage;
  callback_query?:  { id: string; from: TelegramUser; data?: string };
}

async function call<T>(token: string, method: string, body?: Record<string, unknown>): Promise<T> {
  const url = `${BASE}/bot${token}/${method}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    body ? JSON.stringify(body) : undefined,
      signal:  ctrl.signal,
    });
    const data = await res.json() as { ok: boolean; result?: T; description?: string; error_code?: number };
    if (!data.ok) {
      throw new Error(`Telegram API: ${data.description ?? 'unknown error'} (${data.error_code ?? res.status})`);
    }
    return data.result as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Проверяет токен и возвращает инфо о боте — используется при подключении. */
export function getMe(token: string): Promise<TelegramUser> {
  return call<TelegramUser>(token, 'getMe');
}

/** Регистрирует webhook у Telegram. URL обязательно HTTPS. */
export function setWebhook(token: string, url: string, secretToken: string): Promise<boolean> {
  return call<boolean>(token, 'setWebhook', {
    url,
    secret_token: secretToken,
    allowed_updates: ['message', 'edited_message', 'callback_query'],
    drop_pending_updates: false,
  });
}

/** Удаляет webhook (при отключении канала). */
export function deleteWebhook(token: string): Promise<boolean> {
  return call<boolean>(token, 'deleteWebhook');
}

/** Отправляет текстовое сообщение. */
export function sendMessage(token: string, chatId: number | string, text: string): Promise<TelegramMessage> {
  return call<TelegramMessage>(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
}

/** Получить ссылку на файл (фото/документ/voice). */
export async function getFileUrl(token: string, fileId: string): Promise<string> {
  const file = await call<{ file_path: string }>(token, 'getFile', { file_id: fileId });
  return `${BASE}/file/bot${token}/${file.file_path}`;
}

/** Детерминированный secret token для webhook по accountId.
 * Использует AUTH_SECRET как key — не требует хранения в БД, но восстановим в webhook handlerе.
 * Telegram принимает secret_token длиной 1–256 и символы A-Z/a-z/0-9/_/-. hex sha256 влезает. */
export function getWebhookSecret(accountId: string): string {
  const auth = process.env.AUTH_SECRET;
  if (!auth || auth.length < 16) {
    throw new Error('AUTH_SECRET не задан или слишком короткий (нужно минимум 16 символов)');
  }
  return crypto.createHmac('sha256', auth).update(`tg-webhook:${accountId}`).digest('hex');
}

/** Построить публичный URL webhook'а для регистрации у Telegram. */
export function getWebhookUrl(accountId: string): string {
  const base = process.env.APP_PUBLIC_URL || process.env.NEXTAUTH_URL || process.env.AUTH_URL;
  if (!base) {
    throw new Error('Переменная APP_PUBLIC_URL (или NEXTAUTH_URL) не задана — Telegram требует публичный HTTPS URL');
  }
  return `${base.replace(/\/$/, '')}/api/telegram/webhook/${accountId}`;
}
