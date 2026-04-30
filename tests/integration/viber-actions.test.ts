// Server actions для Viber: connect (с откатом при ошибке webhook), disconnect,
// toggle, sendViberFromLead. Anna идея №22.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: {
    requireAdmin: vi.fn(),
    requireUser:  vi.fn(),
  },
  db: {
    viberAccount: {
      findUnique: vi.fn(),
      findFirst:  vi.fn(),
      create:     vi.fn(),
      delete:     vi.fn(),
      update:     vi.fn(),
    },
    lead: {
      findUnique: vi.fn(),
    },
    chatThread: {
      findFirst: vi.fn(),
      update:    vi.fn(),
    },
    chatMessage: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  viber: {
    setViberWebhook:    vi.fn(),
    removeViberWebhook: vi.fn(),
    sendViberText:      vi.fn(),
  },
  permissions: {
    canViewLead: vi.fn(),
  },
  rateLimit: {
    checkRateLimit: vi.fn(),
  },
}));

vi.mock('@/lib/auth',        () => mocks.auth);
vi.mock('@/lib/db',          () => ({ db: mocks.db }));
vi.mock('@/lib/viber',       () => mocks.viber);
vi.mock('@/lib/permissions', () => mocks.permissions);
vi.mock('@/lib/rate-limit',  () => mocks.rateLimit);

const {
  connectViberAccount,
  disconnectViberAccount,
  toggleViberAccount,
  sendViberFromLead,
} = await import('@/app/(app)/settings/channels/viber-actions');

beforeEach(() => {
  vi.clearAllMocks();
  process.env.APP_PUBLIC_URL = 'https://crm.test';
  // Дефолтные моки — каждый тест может переопределить
  mocks.auth.requireAdmin.mockResolvedValue({ id: 'admin', role: 'ADMIN' });
  mocks.auth.requireUser.mockResolvedValue({ id: 'user-1', role: 'SALES' });
  mocks.db.$transaction.mockResolvedValue([]);
  mocks.permissions.canViewLead.mockReturnValue(true);
  mocks.rateLimit.checkRateLimit.mockReturnValue(true);
});

// ============ connectViberAccount ============

describe('connectViberAccount', () => {
  const INPUT = {
    authToken: 'a'.repeat(50),
    paName:    'AZ Group',
    label:     'AZ Viber',
    ownerId:   null,
  };

  it('успех: создаёт аккаунт, регистрирует webhook, помечает isConnected=true', async () => {
    mocks.db.viberAccount.findUnique.mockResolvedValue(null);
    mocks.db.viberAccount.create.mockResolvedValue({ id: 'viber-1' });
    mocks.viber.setViberWebhook.mockResolvedValue({ status: 0 });

    const result = await connectViberAccount(INPUT);

    expect(result).toEqual({ ok: true, accountId: 'viber-1' });
    // setViberWebhook вызван с публичным URL
    expect(mocks.viber.setViberWebhook).toHaveBeenCalledWith(
      INPUT.authToken,
      'https://crm.test/api/viber/webhook?account=viber-1',
    );
    // Финальный update делает isConnected=true
    expect(mocks.db.viberAccount.update).toHaveBeenCalledWith({
      where: { id: 'viber-1' },
      data:  expect.objectContaining({
        isConnected: true,
        webhookUrl:  'https://crm.test/api/viber/webhook?account=viber-1',
      }),
    });
  });

  it('paName уже занят -> throw, аккаунт не создаётся', async () => {
    mocks.db.viberAccount.findUnique.mockResolvedValue({ id: 'existing' });
    await expect(connectViberAccount(INPUT)).rejects.toThrow(/уже подключён/);
    expect(mocks.db.viberAccount.create).not.toHaveBeenCalled();
  });

  it('Viber API вернул status != 0 -> откат: запись удаляется', async () => {
    mocks.db.viberAccount.findUnique.mockResolvedValue(null);
    mocks.db.viberAccount.create.mockResolvedValue({ id: 'viber-rollback' });
    mocks.viber.setViberWebhook.mockResolvedValue({ status: 7, status_message: 'invalid token' });

    await expect(connectViberAccount(INPUT)).rejects.toThrow(/invalid token/);
    expect(mocks.db.viberAccount.delete).toHaveBeenCalledWith({ where: { id: 'viber-rollback' } });
  });

  it('APP_PUBLIC_URL не задан -> throw, запись удаляется', async () => {
    delete process.env.APP_PUBLIC_URL;
    mocks.db.viberAccount.findUnique.mockResolvedValue(null);
    mocks.db.viberAccount.create.mockResolvedValue({ id: 'viber-x' });

    await expect(connectViberAccount(INPUT)).rejects.toThrow(/APP_PUBLIC_URL/);
    expect(mocks.db.viberAccount.delete).toHaveBeenCalled();
    expect(mocks.viber.setViberWebhook).not.toHaveBeenCalled();
  });

  it('сетевая ошибка setViberWebhook -> откат', async () => {
    mocks.db.viberAccount.findUnique.mockResolvedValue(null);
    mocks.db.viberAccount.create.mockResolvedValue({ id: 'viber-net-err' });
    mocks.viber.setViberWebhook.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(connectViberAccount(INPUT)).rejects.toThrow('ECONNREFUSED');
    expect(mocks.db.viberAccount.delete).toHaveBeenCalledWith({ where: { id: 'viber-net-err' } });
  });

  it('не админ -> requireAdmin бросает, ничего не делается', async () => {
    mocks.auth.requireAdmin.mockRejectedValue(new Error('Недостаточно прав'));
    await expect(connectViberAccount(INPUT)).rejects.toThrow(/Недостаточно/);
    expect(mocks.db.viberAccount.create).not.toHaveBeenCalled();
  });
});

// ============ disconnectViberAccount ============

describe('disconnectViberAccount', () => {
  it('снимает webhook и удаляет запись', async () => {
    mocks.db.viberAccount.findUnique.mockResolvedValue({
      id: 'v1', authToken: 'token-x',
    });
    mocks.viber.removeViberWebhook.mockResolvedValue({ status: 0 });

    await disconnectViberAccount('v1');

    expect(mocks.viber.removeViberWebhook).toHaveBeenCalledWith('token-x');
    expect(mocks.db.viberAccount.delete).toHaveBeenCalledWith({ where: { id: 'v1' } });
  });

  it('removeWebhook упал -> запись всё равно удаляется', async () => {
    mocks.db.viberAccount.findUnique.mockResolvedValue({ id: 'v1', authToken: 't' });
    mocks.viber.removeViberWebhook.mockRejectedValue(new Error('viber down'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await disconnectViberAccount('v1');

    expect(mocks.db.viberAccount.delete).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('аккаунт не найден -> throw', async () => {
    mocks.db.viberAccount.findUnique.mockResolvedValue(null);
    await expect(disconnectViberAccount('missing')).rejects.toThrow(/не найден/);
  });
});

// ============ toggleViberAccount ============

describe('toggleViberAccount', () => {
  it('обновляет isActive', async () => {
    await toggleViberAccount('v1', false);
    expect(mocks.db.viberAccount.update).toHaveBeenCalledWith({
      where: { id: 'v1' }, data: { isActive: false },
    });
  });
});

// ============ sendViberFromLead ============

describe('sendViberFromLead', () => {
  const INPUT = { leadId: 'lead-1', accountId: 'v1', body: 'Привет' };

  beforeEach(() => {
    mocks.db.lead.findUnique.mockResolvedValue({
      id: 'lead-1', clientId: 'client-1',
      salesManagerId: 'user-1', legalManagerId: null,
    });
    mocks.db.viberAccount.findFirst.mockResolvedValue({
      id: 'v1', label: 'AZ Viber', isActive: true, isConnected: true,
      authToken: 't', paName: 'AZ',
    });
    mocks.db.chatThread.findFirst.mockResolvedValue({
      id: 'thread-1', externalId: 'viber-user-id',
    });
    mocks.viber.sendViberText.mockResolvedValue({ status: 0, message_token: 999 });
  });

  it('успех: шлёт через Viber API + сохраняет message + revalidate', async () => {
    await sendViberFromLead(INPUT);

    expect(mocks.viber.sendViberText).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'v1' }),
      'viber-user-id',
      'Привет',
    );
    expect(mocks.db.$transaction).toHaveBeenCalled();
  });

  it('rate-limit -> throw без отправки', async () => {
    mocks.rateLimit.checkRateLimit.mockReturnValue(false);
    await expect(sendViberFromLead(INPUT)).rejects.toThrow(/Слишком много/);
    expect(mocks.viber.sendViberText).not.toHaveBeenCalled();
  });

  it('нет прав на лид -> throw', async () => {
    mocks.permissions.canViewLead.mockReturnValue(false);
    await expect(sendViberFromLead(INPUT)).rejects.toThrow(/Нет доступа/);
  });

  it('канал не подключён -> throw', async () => {
    mocks.db.viberAccount.findFirst.mockResolvedValue({
      id: 'v1', label: 'AZ Viber', isActive: true, isConnected: false,
    });
    await expect(sendViberFromLead(INPUT)).rejects.toThrow(/не подключён/);
  });

  it('thread без externalId (клиент не писал) -> throw, не шлёт', async () => {
    mocks.db.chatThread.findFirst.mockResolvedValue(null);
    await expect(sendViberFromLead(INPUT)).rejects.toThrow(/не писал/);
    expect(mocks.viber.sendViberText).not.toHaveBeenCalled();
  });

  it('Viber API вернул status != 0 -> throw', async () => {
    mocks.viber.sendViberText.mockResolvedValue({ status: 5, status_message: 'spam' });
    await expect(sendViberFromLead(INPUT)).rejects.toThrow(/spam/);
  });
});
