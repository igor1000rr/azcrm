// Юнит-тесты verifyWebhookToken в src/lib/whatsapp/index.ts.
//
// Раньше эта функция при пустом WORKER_AUTH_TOKEN возвращала true — это означало
// что любой мог отправлять фейковые входящие сообщения. После моего фикса:
//   - пустой token в env → все запросы false
//   - сравнение через timingSafeEqual + length check
import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

async function loadWith(token: string | undefined) {
  if (token === undefined) delete process.env.WHATSAPP_WORKER_TOKEN;
  else process.env.WHATSAPP_WORKER_TOKEN = token;
  return import('@/lib/whatsapp');
}

describe('verifyWebhookToken: WORKER_AUTH_TOKEN не задан', () => {
  it('любой токен отвергается (бывший open-bug)', async () => {
    const { verifyWebhookToken } = await loadWith(undefined);
    expect(verifyWebhookToken('any-token')).toBe(false);
    expect(verifyWebhookToken('')).toBe(false);
    expect(verifyWebhookToken(null)).toBe(false);
  });
});

describe('verifyWebhookToken: токен задан', () => {
  const TOKEN = 'wh-token-32-bytes-aaaabbbbccccdddd';

  it('null → false', async () => {
    const { verifyWebhookToken } = await loadWith(TOKEN);
    expect(verifyWebhookToken(null)).toBe(false);
  });

  it('пустая строка → false', async () => {
    const { verifyWebhookToken } = await loadWith(TOKEN);
    expect(verifyWebhookToken('')).toBe(false);
  });

  it('другая длина → false (timingSafeEqual не падает)', async () => {
    const { verifyWebhookToken } = await loadWith(TOKEN);
    expect(verifyWebhookToken('short')).toBe(false);
    expect(verifyWebhookToken(TOKEN + 'extra')).toBe(false);
  });

  it('верная длина, но другое содержимое → false', async () => {
    const { verifyWebhookToken } = await loadWith(TOKEN);
    const wrong = 'X'.repeat(TOKEN.length);
    expect(verifyWebhookToken(wrong)).toBe(false);
  });

  it('идентичный токен → true', async () => {
    const { verifyWebhookToken } = await loadWith(TOKEN);
    expect(verifyWebhookToken(TOKEN)).toBe(true);
  });
});
