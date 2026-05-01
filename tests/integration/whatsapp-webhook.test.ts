// Интеграционные тесты WhatsApp webhook — самый критичный endpoint для чатов.
//
// Покрываем:
//   - Авторизация: неверный токен → 401
//   - Дедупликация: то же externalId дважды → второй раз deduplicated
//   - Новый клиент → создаётся client + thread + message (БЕЗ лида —
//     лид создаётся вручную из карточки клиента, Anna 01.05.2026)
//   - Существующий клиент → client.create НЕ вызывается
//   - thread.unreadCount инкрементится
//   - notify вызывается владельцу канала
//   - message.status обновляет deliveredAt/readAt
//   - connection обновляет isConnected
import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = ReturnType<typeof vi.fn>;

const mockDb = {
  chatMessage:    {
    findFirst:  vi.fn() as AnyFn,
    create:     vi.fn() as AnyFn,
    updateMany: vi.fn() as AnyFn,
  },
  whatsappAccount: {
    findUnique: vi.fn() as AnyFn,
    update:     vi.fn() as AnyFn,
  },
  client:    { findUnique: vi.fn() as AnyFn, create: vi.fn() as AnyFn },
  // funnel/lead больше не нужны в webhook (Anna 01.05.2026: автосоздание
  // лида убрано — менеджер создаёт его вручную из карточки клиента).
  // Моки оставлены чтобы тесты «существующий клиент» могли проверить что
  // lead.create НЕ вызывается даже если бы кто-то добавил эту логику обратно.
  funnel:    { findFirst:  vi.fn() as AnyFn },
  lead:      { create:     vi.fn() as AnyFn },
  chatThread:{ findFirst:  vi.fn() as AnyFn, create: vi.fn() as AnyFn, update: vi.fn() as AnyFn },
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: typeof mockDb) => Promise<unknown>)(mockDb);
    if (Array.isArray(arg)) return Promise.all(arg);
  }) as AnyFn,
};

const mockNotify = vi.fn();
const mockVerify = vi.fn();

vi.mock('@/lib/db',       () => ({ db: mockDb }));
vi.mock('@/lib/whatsapp', () => ({ verifyWebhookToken: mockVerify }));
vi.mock('@/lib/notify',   () => ({ notify: mockNotify }));
vi.mock('@/lib/utils',    () => ({
  // Простой normalizePhone — убираем всё кроме цифр и ведущего +
  normalizePhone: (s: string) => '+' + (s || '').replace(/\D/g, ''),
}));

const { POST } = await import('@/app/api/whatsapp/webhook/route');

beforeEach(() => {
  Object.values(mockDb).forEach((entity) => {
    if (typeof entity === 'function') {
      (entity as AnyFn).mockReset();
    } else {
      Object.values(entity).forEach((fn) => (fn as AnyFn).mockReset());
    }
  });
  mockDb.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: typeof mockDb) => Promise<unknown>)(mockDb);
    if (Array.isArray(arg)) return Promise.all(arg);
  });
  mockNotify.mockReset();
  mockVerify.mockReset();
  mockVerify.mockReturnValue(true); // по умолчанию токен валиден
});

function makeReq(body: unknown, opts: { token?: string } = {}): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token !== undefined) headers.authorization = `Bearer ${opts.token}`;
  return new Request('http://localhost/api/whatsapp/webhook', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('webhook auth', () => {
  it('verifyWebhookToken=false → 401', async () => {
    mockVerify.mockReturnValue(false);
    const res = await POST(makeReq({ kind: 'message.in' }, { token: 'wrong' }) as never);
    expect(res.status).toBe(401);
  });

  it('без Authorization → verify получает пустой токен', async () => {
    mockVerify.mockReturnValue(false);
    const res = await POST(makeReq({ kind: 'message.in' }) as never);
    expect(res.status).toBe(401);
    expect(mockVerify).toHaveBeenCalledWith('');
  });
});

describe('handleIncomingMessage: дедупликация', () => {
  it('externalId уже был → deduplicated, ничего не создаётся', async () => {
    mockDb.chatMessage.findFirst.mockResolvedValue({ id: 'existing-msg' });

    const res = await POST(makeReq({
      kind: 'message.in',
      accountId:  'acc-1',
      externalId: 'wa-msg-123',
      fromPhone:  '+48123',
      type:       'text',
      body:       'hi',
      timestamp:  Date.now(),
    }, { token: 't' }) as never);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deduplicated).toBe(true);
    expect(mockDb.client.create).not.toHaveBeenCalled();
    expect(mockDb.chatMessage.create).not.toHaveBeenCalled();
  });
});

describe('handleIncomingMessage: новый клиент', () => {
  beforeEach(() => {
    mockDb.chatMessage.findFirst.mockResolvedValue(null); // не дубль
    mockDb.whatsappAccount.findUnique.mockResolvedValue({
      id: 'acc-1', ownerId: 'u-anna', label: 'Anna WA', phoneNumber: '+48999',
    });
    mockDb.client.findUnique.mockResolvedValue(null); // новый
    mockDb.client.create.mockResolvedValue({ id: 'c-new' });
    mockDb.chatThread.findFirst.mockResolvedValue(null);
    mockDb.chatThread.create.mockResolvedValue({ id: 't-new' });
  });

  it('создаётся client + thread + message (без лида)', async () => {
    const res = await POST(makeReq({
      kind: 'message.in',
      accountId:  'acc-1',
      externalId: 'wa-msg-1',
      fromPhone:  '+48123456789',
      fromName:   'Иван',
      type:       'text',
      body:       'Привет',
      timestamp:  1700000000000,
    }, { token: 't' }) as never);

    expect(res.status).toBe(200);
    expect(mockDb.client.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fullName: 'Иван',
          phone:    '+48123456789',
          ownerId:  'u-anna',
          source:   expect.stringContaining('WhatsApp'),
        }),
      }),
    );
    // Лид НЕ создаётся автоматически — менеджер создаст вручную из карточки
    expect(mockDb.lead.create).not.toHaveBeenCalled();
    expect(mockDb.chatThread.create).toHaveBeenCalled();
    expect(mockDb.chatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          threadId:   't-new',
          direction:  'IN',
          type:       'TEXT',
          body:       'Привет',
          externalId: 'wa-msg-1',
        }),
      }),
    );
  });

  it('без fromName — имя "Клиент +<phone>"', async () => {
    await POST(makeReq({
      kind: 'message.in',
      accountId:  'acc-1',
      externalId: 'wa-msg-2',
      fromPhone:  '+48000',
      type:       'text',
      timestamp:  Date.now(),
    }, { token: 't' }) as never);

    const call = mockDb.client.create.mock.calls[0][0];
    expect(call.data.fullName).toMatch(/Клиент/);
    expect(call.data.fullName).toContain('+48000');
  });

  it('webhook возвращает 200 даже если в системе нет воронок (лид не создаём)', async () => {
    // Раньше webhook искал дефолтную воронку и падал с 500 если её не было.
    // Теперь воронка не нужна — webhook сохраняет только клиента и сообщение.
    mockDb.funnel.findFirst.mockResolvedValue(null);
    const res = await POST(makeReq({
      kind: 'message.in',
      accountId:  'acc-1',
      externalId: 'wa-msg-3',
      fromPhone:  '+48555',
      type:       'text',
      body:       'тест',
      timestamp:  Date.now(),
    }, { token: 't' }) as never);
    expect(res.status).toBe(200);
    expect(mockDb.lead.create).not.toHaveBeenCalled();
    expect(mockDb.client.create).toHaveBeenCalled();
    expect(mockDb.chatMessage.create).toHaveBeenCalled();
  });
});

describe('handleIncomingMessage: существующий клиент', () => {
  it('client.create НЕ вызывается, но thread может быть создан впервые', async () => {
    mockDb.chatMessage.findFirst.mockResolvedValue(null);
    mockDb.whatsappAccount.findUnique.mockResolvedValue({
      id: 'acc-1', ownerId: 'u-1', label: 'A', phoneNumber: '+48',
    });
    mockDb.client.findUnique.mockResolvedValue({ id: 'c-existing' });
    mockDb.chatThread.findFirst.mockResolvedValue(null);
    mockDb.chatThread.create.mockResolvedValue({ id: 't-1' });

    await POST(makeReq({
      kind: 'message.in', accountId: 'acc-1', externalId: 'm-1',
      fromPhone: '+48111', type: 'text', body: 'x', timestamp: Date.now(),
    }, { token: 't' }) as never);

    expect(mockDb.client.create).not.toHaveBeenCalled();
    expect(mockDb.lead.create).not.toHaveBeenCalled();
    expect(mockDb.chatThread.create).toHaveBeenCalled();
  });

  it('существующий тред → chatThread.create НЕ вызывается', async () => {
    mockDb.chatMessage.findFirst.mockResolvedValue(null);
    mockDb.whatsappAccount.findUnique.mockResolvedValue({
      id: 'acc-1', ownerId: null, label: 'A', phoneNumber: '+48',
    });
    mockDb.client.findUnique.mockResolvedValue({ id: 'c-1' });
    mockDb.chatThread.findFirst.mockResolvedValue({ id: 't-existing' });

    await POST(makeReq({
      kind: 'message.in', accountId: 'acc-1', externalId: 'm-1',
      fromPhone: '+48', type: 'text', body: 'y', timestamp: Date.now(),
    }, { token: 't' }) as never);

    expect(mockDb.chatThread.create).not.toHaveBeenCalled();
  });
});

describe('handleIncomingMessage: media + unreadCount + notify', () => {
  beforeEach(() => {
    mockDb.chatMessage.findFirst.mockResolvedValue(null);
    mockDb.whatsappAccount.findUnique.mockResolvedValue({
      id: 'acc-1', ownerId: 'u-anna', label: 'A', phoneNumber: '+48',
    });
    mockDb.client.findUnique.mockResolvedValue({ id: 'c-1' });
    mockDb.chatThread.findFirst.mockResolvedValue({ id: 't-1' });
  });

  it('media из worker’а сохраняется в chatMessage.mediaUrl', async () => {
    await POST(makeReq({
      kind: 'message.in', accountId: 'acc-1', externalId: 'm-1',
      fromPhone: '+48', type: 'document',
      mediaUrl: '/api/files/wa-media/12345-abc.pdf',
      mediaName: 'passport.pdf',
      mediaSize: 102400,
      timestamp: Date.now(),
    }, { token: 't' }) as never);

    expect(mockDb.chatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type:      'DOCUMENT',
          mediaUrl:  '/api/files/wa-media/12345-abc.pdf',
          mediaName: 'passport.pdf',
          mediaSize: 102400,
        }),
      }),
    );
  });

  it('unreadCount инкрементится в треде', async () => {
    await POST(makeReq({
      kind: 'message.in', accountId: 'acc-1', externalId: 'm-1',
      fromPhone: '+48', type: 'text', body: 'x', timestamp: Date.now(),
    }, { token: 't' }) as never);

    // chatThread.update вызывается через $transaction — проверяем последний вызов
    const updateCall = mockDb.chatThread.update.mock.calls[0][0];
    expect(updateCall.data.unreadCount).toEqual({ increment: 1 });
  });

  it('notify вызывается владельцу канала', async () => {
    await POST(makeReq({
      kind: 'message.in', accountId: 'acc-1', externalId: 'm-1',
      fromPhone: '+48', fromName: 'Boris',
      type: 'text', body: 'hello', timestamp: Date.now(),
    }, { token: 't' }) as never);

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-anna',
        kind:   'NEW_MESSAGE',
        link:   '/inbox?thread=t-1',
      }),
    );
  });

  it('без ownerId канала — notify НЕ вызывается', async () => {
    mockDb.whatsappAccount.findUnique.mockResolvedValue({
      id: 'acc-1', ownerId: null, label: 'A', phoneNumber: '+48',
    });
    await POST(makeReq({
      kind: 'message.in', accountId: 'acc-1', externalId: 'm-1',
      fromPhone: '+48', type: 'text', body: 'x', timestamp: Date.now(),
    }, { token: 't' }) as never);
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe('handleMessageStatus', () => {
  it('delivered → deliveredAt', async () => {
    await POST(makeReq({
      kind: 'message.status',
      accountId: 'acc-1', externalId: 'm-1', status: 'delivered',
    }, { token: 't' }) as never);

    expect(mockDb.chatMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { externalId: 'm-1', whatsappAccountId: 'acc-1' },
        data:  expect.objectContaining({ deliveredAt: expect.any(Date) }),
      }),
    );
  });

  it('read → readAt + isRead=true', async () => {
    await POST(makeReq({
      kind: 'message.status',
      accountId: 'acc-1', externalId: 'm-1', status: 'read',
    }, { token: 't' }) as never);

    const call = mockDb.chatMessage.updateMany.mock.calls[0][0];
    expect(call.data).toMatchObject({ readAt: expect.any(Date), isRead: true });
  });
});

describe('handleConnection', () => {
  it('ready → isConnected=true + lastSeenAt', async () => {
    await POST(makeReq({
      kind: 'connection',
      accountId: 'acc-1', status: 'ready',
    }, { token: 't' }) as never);

    expect(mockDb.whatsappAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'acc-1' },
        data:  expect.objectContaining({ isConnected: true, lastSeenAt: expect.any(Date) }),
      }),
    );
  });

  it('disconnected → isConnected=false, lastSeenAt undefined', async () => {
    await POST(makeReq({
      kind: 'connection',
      accountId: 'acc-1', status: 'disconnected',
    }, { token: 't' }) as never);

    const call = mockDb.whatsappAccount.update.mock.calls[0][0];
    expect(call.data.isConnected).toBe(false);
    expect(call.data.lastSeenAt).toBeUndefined();
  });
});

describe('unknown kind', () => {
  it('→ 400', async () => {
    const res = await POST(makeReq({ kind: 'mystery' }, { token: 't' }) as never);
    expect(res.status).toBe(400);
  });
});
