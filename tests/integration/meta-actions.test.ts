// Server actions для Meta. Anna idea #22.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { requireAdmin: vi.fn(), requireUser: vi.fn() },
  db: {
    metaAccount: {
      findUnique: vi.fn(), findFirst: vi.fn(),
      create: vi.fn(), delete: vi.fn(), update: vi.fn(),
    },
    lead:        { findUnique: vi.fn() },
    chatThread:  { findFirst: vi.fn() },
    chatMessage: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  meta: { sendMessengerText: vi.fn(), sendInstagramText: vi.fn() },
  permissions: { canViewLead: vi.fn() },
  rateLimit:   { checkRateLimit: vi.fn() },
}));

vi.mock('@/lib/auth',        () => mocks.auth);
vi.mock('@/lib/db',          () => ({ db: mocks.db }));
vi.mock('@/lib/meta',        () => mocks.meta);
vi.mock('@/lib/permissions', () => mocks.permissions);
vi.mock('@/lib/rate-limit',  () => mocks.rateLimit);

const {
  connectMetaAccount,
  disconnectMetaAccount,
  toggleMetaAccount,
  sendMetaFromLead,
} = await import('@/app/(app)/settings/channels/meta-actions');

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.requireAdmin.mockResolvedValue({ id: 'admin', role: 'ADMIN' });
  mocks.auth.requireUser.mockResolvedValue({ id: 'user-1', role: 'SALES' });
  mocks.db.$transaction.mockResolvedValue([]);
  mocks.permissions.canViewLead.mockReturnValue(true);
  mocks.rateLimit.checkRateLimit.mockReturnValue(true);
});

afterEach(() => { globalThis.fetch = originalFetch; });

describe('connectMetaAccount', () => {
  const INPUT = {
    pageAccessToken: 'EAAB' + 'a'.repeat(40),
    appSecret:       's'.repeat(32),
    verifyToken:     'verify-token',
    label:           'AZ FB',
    ownerId:         null,
  };

  it('FB Page без IG -> hasInstagram=false', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ id: 'page-123', name: 'AZ Group Page' }),
    }) as typeof fetch;
    mocks.db.metaAccount.findUnique.mockResolvedValue(null);
    mocks.db.metaAccount.create.mockResolvedValue({ id: 'meta-1' });

    const r = await connectMetaAccount(INPUT);
    expect(r.ok).toBe(true);
    expect(r.hasInstagram).toBe(false);
    expect(mocks.db.metaAccount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        pageId: 'page-123', pageName: 'AZ Group Page',
        hasMessenger: true, hasInstagram: false, igUserId: null,
      }),
    });
  });

  it('FB Page с IG -> hasInstagram=true, igUsername сохраняется', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({
        id: 'page-456', name: 'AZ',
        instagram_business_account: { id: 'ig-789', username: 'azgroup' },
      }),
    }) as typeof fetch;
    mocks.db.metaAccount.findUnique.mockResolvedValue(null);
    mocks.db.metaAccount.create.mockResolvedValue({ id: 'meta-2' });

    const r = await connectMetaAccount(INPUT);
    expect(r.hasInstagram).toBe(true);
    expect(r.igUsername).toBe('azgroup');
    expect(mocks.db.metaAccount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        igUserId: 'ig-789', igUsername: 'azgroup', hasInstagram: true,
      }),
    });
  });

  it('Graph API error -> throw, не создаёт', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ error: { message: 'Invalid OAuth' } }),
    }) as typeof fetch;
    await expect(connectMetaAccount(INPUT)).rejects.toThrow(/Invalid OAuth/);
    expect(mocks.db.metaAccount.create).not.toHaveBeenCalled();
  });

  it('pageId дубль -> throw', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ id: 'page-123', name: 'X' }),
    }) as typeof fetch;
    mocks.db.metaAccount.findUnique.mockResolvedValue({ id: 'existing' });
    await expect(connectMetaAccount(INPUT)).rejects.toThrow(/уже подключена/);
  });

  it('GET /me запрашивает поля instagram_business_account', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      json: async () => ({ id: 'p', name: 'P' }),
    });
    globalThis.fetch = fetchSpy as typeof fetch;
    mocks.db.metaAccount.findUnique.mockResolvedValue(null);
    mocks.db.metaAccount.create.mockResolvedValue({ id: 'm' });

    await connectMetaAccount(INPUT);
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('graph.facebook.com');
    expect(url).toContain('instagram_business_account');
  });
});

describe('disconnectMetaAccount', () => {
  it('удаляет запись', async () => {
    mocks.db.metaAccount.findUnique.mockResolvedValue({ id: 'm1' });
    await disconnectMetaAccount('m1');
    expect(mocks.db.metaAccount.delete).toHaveBeenCalledWith({ where: { id: 'm1' } });
  });

  it('не найден -> throw', async () => {
    mocks.db.metaAccount.findUnique.mockResolvedValue(null);
    await expect(disconnectMetaAccount('miss')).rejects.toThrow(/не найден/);
  });
});

describe('toggleMetaAccount', () => {
  it('обновляет isActive', async () => {
    await toggleMetaAccount('m1', true);
    expect(mocks.db.metaAccount.update).toHaveBeenCalledWith({
      where: { id: 'm1' }, data: { isActive: true },
    });
  });
});

describe('sendMetaFromLead', () => {
  const FB = {
    id: 'm1', label: 'AZ FB', isActive: true, isConnected: true,
    pageId: 'p', pageAccessToken: 't', hasMessenger: true, hasInstagram: true,
  };

  beforeEach(() => {
    mocks.db.lead.findUnique.mockResolvedValue({
      id: 'lead-1', clientId: 'c1',
      salesManagerId: 'user-1', legalManagerId: null,
    });
    mocks.db.metaAccount.findFirst.mockResolvedValue(FB);
    mocks.db.chatThread.findFirst.mockResolvedValue({
      id: 'thread-1', externalId: 'psid',
    });
    mocks.meta.sendMessengerText.mockResolvedValue({ message_id: 'mid-1' });
    mocks.meta.sendInstagramText.mockResolvedValue({ message_id: 'mid-ig' });
  });

  it('MESSENGER -> sendMessengerText', async () => {
    await sendMetaFromLead({
      leadId: 'lead-1', accountId: 'm1', channel: 'MESSENGER', body: 'Hi',
    });
    expect(mocks.meta.sendMessengerText).toHaveBeenCalledWith(FB, 'psid', 'Hi');
    expect(mocks.meta.sendInstagramText).not.toHaveBeenCalled();
  });

  it('INSTAGRAM -> sendInstagramText', async () => {
    await sendMetaFromLead({
      leadId: 'lead-1', accountId: 'm1', channel: 'INSTAGRAM', body: 'Hi',
    });
    expect(mocks.meta.sendInstagramText).toHaveBeenCalledWith(FB, 'psid', 'Hi');
    expect(mocks.meta.sendMessengerText).not.toHaveBeenCalled();
  });

  it('INSTAGRAM но IG не подключён -> throw', async () => {
    mocks.db.metaAccount.findFirst.mockResolvedValue({ ...FB, hasInstagram: false });
    await expect(sendMetaFromLead({
      leadId: 'lead-1', accountId: 'm1', channel: 'INSTAGRAM', body: 'x',
    })).rejects.toThrow(/Instagram не подключён/);
  });

  it('Meta API error -> throw', async () => {
    mocks.meta.sendMessengerText.mockResolvedValue({
      error: { message: 'User has not opted in', code: 10 },
    });
    await expect(sendMetaFromLead({
      leadId: 'lead-1', accountId: 'm1', channel: 'MESSENGER', body: 'x',
    })).rejects.toThrow(/User has not opted/);
  });

  it('rate-limit -> throw', async () => {
    mocks.rateLimit.checkRateLimit.mockReturnValue(false);
    await expect(sendMetaFromLead({
      leadId: 'lead-1', accountId: 'm1', channel: 'MESSENGER', body: 'x',
    })).rejects.toThrow(/Слишком много/);
  });

  it('нет прав -> throw', async () => {
    mocks.permissions.canViewLead.mockReturnValue(false);
    await expect(sendMetaFromLead({
      leadId: 'lead-1', accountId: 'm1', channel: 'MESSENGER', body: 'x',
    })).rejects.toThrow(/Нет доступа/);
  });

  it('thread не найден -> throw, не шлёт', async () => {
    mocks.db.chatThread.findFirst.mockResolvedValue(null);
    await expect(sendMetaFromLead({
      leadId: 'lead-1', accountId: 'm1', channel: 'MESSENGER', body: 'x',
    })).rejects.toThrow(/не писал/);
    expect(mocks.meta.sendMessengerText).not.toHaveBeenCalled();
  });
});
