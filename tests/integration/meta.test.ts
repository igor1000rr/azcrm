// Unit + Integration: lib/meta — verifyMetaSignature + handleMetaWebhook
// Anna idea #22 (Messenger + Instagram).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

import { verifyMetaSignature } from '@/lib/meta';

describe('verifyMetaSignature', () => {
  const SECRET = 'fb-app-secret-test';
  const BODY   = '{"object":"page","entry":[]}';

  function sign(secret: string, body: string): string {
    return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  }

  it('valid sha256= signature -> true', () => {
    expect(verifyMetaSignature(SECRET, BODY, sign(SECRET, BODY))).toBe(true);
  });

  it('hex without sha256= prefix also accepted', () => {
    const hex = crypto.createHmac('sha256', SECRET).update(BODY).digest('hex');
    expect(verifyMetaSignature(SECRET, BODY, hex)).toBe(true);
  });

  it('wrong secret -> false', () => {
    expect(verifyMetaSignature(SECRET, BODY, sign('wrong', BODY))).toBe(false);
  });

  it('tampered body -> false', () => {
    expect(verifyMetaSignature(SECRET, BODY + ' x', sign(SECRET, BODY))).toBe(false);
  });

  it('empty header -> false', () => {
    expect(verifyMetaSignature(SECRET, BODY, null)).toBe(false);
    expect(verifyMetaSignature(SECRET, BODY, '')).toBe(false);
  });

  it('empty secret -> false', () => {
    expect(verifyMetaSignature('', BODY, sign(SECRET, BODY))).toBe(false);
  });

  it('garbage hex after prefix -> false without throw', () => {
    expect(verifyMetaSignature(SECRET, BODY, 'sha256=abc')).toBe(false);
  });

  it('right length but wrong digest -> false', () => {
    expect(verifyMetaSignature(SECRET, BODY, 'sha256=' + '0'.repeat(64))).toBe(false);
  });
});

const mocks = vi.hoisted(() => ({
  db: {
    metaAccount: { findFirst: vi.fn(), update: vi.fn() },
    chatThread:  { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    chatMessage: { create: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({ db: mocks.db }));

const { handleMetaWebhook } = await import('@/lib/meta');

const FB_ACCOUNT = {
  id: 'meta-1', pageId: 'page-123', pageName: 'AZ', pageAccessToken: 't',
  appSecret: 's', verifyToken: 'v', igUserId: null, igUsername: null,
  hasMessenger: true, hasInstagram: false, label: 'AZ FB', ownerId: null,
  isConnected: true, isActive: true,
  createdAt: new Date(), updatedAt: new Date(), lastSeenAt: null,
};

const IG_ACCOUNT = {
  ...FB_ACCOUNT, igUserId: 'ig-456', igUsername: 'azgroup', hasInstagram: true,
};

beforeEach(() => {
  mocks.db.metaAccount.findFirst.mockReset();
  mocks.db.metaAccount.update.mockReset();
  mocks.db.chatThread.findFirst.mockReset();
  mocks.db.chatThread.create.mockReset();
  mocks.db.chatThread.update.mockReset();
  mocks.db.chatMessage.create.mockReset();
  mocks.db.metaAccount.update.mockResolvedValue({});
  mocks.db.chatThread.update.mockResolvedValue({});
  mocks.db.chatMessage.create.mockResolvedValue({});
});

describe('handleMetaWebhook', () => {
  it('Messenger event resolved by pageId', async () => {
    mocks.db.metaAccount.findFirst.mockResolvedValue(FB_ACCOUNT);
    mocks.db.chatThread.findFirst.mockResolvedValue(null);
    mocks.db.chatThread.create.mockResolvedValue({ id: 'thread-fb' });

    const result = await handleMetaWebhook({
      object: 'page',
      entry: [{
        id: 'page-123',
        messaging: [{
          sender: { id: 'psid-user-1' },
          recipient: { id: 'page-123' },
          message: { mid: 'mid-1', text: 'Hello from Messenger' },
        }],
      }],
    });

    expect(result.processed).toBe(1);
    expect(mocks.db.metaAccount.findFirst).toHaveBeenCalledWith({ where: { pageId: 'page-123' } });
    expect(mocks.db.chatThread.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        channel: 'MESSENGER', metaAccountId: 'meta-1', externalId: 'psid-user-1',
      }),
    });
    expect(mocks.db.chatMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        threadId: 'thread-fb', metaAccountId: 'meta-1',
        direction: 'IN', body: 'Hello from Messenger', externalId: 'mid-1',
      }),
    });
  });

  it('Instagram event resolved by igUserId, channel=INSTAGRAM', async () => {
    mocks.db.metaAccount.findFirst.mockResolvedValue(IG_ACCOUNT);
    mocks.db.chatThread.findFirst.mockResolvedValue(null);
    mocks.db.chatThread.create.mockResolvedValue({ id: 'thread-ig' });

    await handleMetaWebhook({
      object: 'instagram',
      entry: [{
        id: 'ig-456',
        messaging: [{
          sender: { id: 'igsid-user' },
          recipient: { id: 'ig-456' },
          message: { mid: 'mid-2', text: 'IG DM' },
        }],
      }],
    });

    expect(mocks.db.metaAccount.findFirst).toHaveBeenCalledWith({ where: { igUserId: 'ig-456' } });
    expect(mocks.db.chatThread.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ channel: 'INSTAGRAM', externalId: 'igsid-user' }),
    });
  });

  it('is_echo (our own outgoing) -> skipped, not saved', async () => {
    mocks.db.metaAccount.findFirst.mockResolvedValue(FB_ACCOUNT);

    const result = await handleMetaWebhook({
      object: 'page',
      entry: [{
        id: 'page-123',
        messaging: [{
          sender: { id: 'page-123' },
          recipient: { id: 'psid-user' },
          message: { mid: 'echo-1', text: 'reply', is_echo: true },
        }],
      }],
    });

    expect(result.processed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mocks.db.chatMessage.create).not.toHaveBeenCalled();
  });

  it('postback (no message) -> skipped', async () => {
    mocks.db.metaAccount.findFirst.mockResolvedValue(FB_ACCOUNT);

    const result = await handleMetaWebhook({
      object: 'page',
      entry: [{
        id: 'page-123',
        messaging: [{
          sender: { id: 'u1' },
          recipient: { id: 'page-123' },
          postback: { payload: 'GET_STARTED', title: 'start' },
        }],
      }],
    });

    expect(result.skipped).toBe(1);
    expect(mocks.db.chatMessage.create).not.toHaveBeenCalled();
  });

  it('account not found -> skipped, db not touched', async () => {
    mocks.db.metaAccount.findFirst.mockResolvedValue(null);

    const result = await handleMetaWebhook({
      object: 'page',
      entry: [{ id: 'unknown', messaging: [{
        sender: { id: 'u' }, recipient: { id: 'unknown' },
        message: { mid: 'm', text: 't' },
      }]}],
    });

    expect(result.skipped).toBe(1);
    expect(mocks.db.chatThread.findFirst).not.toHaveBeenCalled();
  });

  it('inactive account -> skipped', async () => {
    mocks.db.metaAccount.findFirst.mockResolvedValue({ ...FB_ACCOUNT, isActive: false });

    const result = await handleMetaWebhook({
      object: 'page',
      entry: [{ id: 'page-123', messaging: [{
        sender: { id: 'u' }, recipient: { id: 'page-123' },
        message: { mid: 'm', text: 't' },
      }]}],
    });

    expect(result.skipped).toBe(1);
  });

  it('image attachment -> type=IMAGE', async () => {
    mocks.db.metaAccount.findFirst.mockResolvedValue(FB_ACCOUNT);
    mocks.db.chatThread.findFirst.mockResolvedValue({ id: 't' });

    await handleMetaWebhook({
      object: 'page',
      entry: [{ id: 'page-123', messaging: [{
        sender: { id: 'u' }, recipient: { id: 'page-123' },
        message: {
          mid: 'm-img',
          attachments: [{ type: 'image', payload: { url: 'https://fb/img.jpg' } }],
        },
      }]}],
    });

    expect(mocks.db.chatMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'IMAGE', mediaUrl: 'https://fb/img.jpg' }),
    });
  });

  it('file attachment -> type=DOCUMENT', async () => {
    mocks.db.metaAccount.findFirst.mockResolvedValue(FB_ACCOUNT);
    mocks.db.chatThread.findFirst.mockResolvedValue({ id: 't' });

    await handleMetaWebhook({
      object: 'page',
      entry: [{ id: 'page-123', messaging: [{
        sender: { id: 'u' }, recipient: { id: 'page-123' },
        message: {
          mid: 'm-doc',
          attachments: [{ type: 'file', payload: { url: 'https://fb/doc.pdf' } }],
        },
      }]}],
    });

    expect(mocks.db.chatMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'DOCUMENT', mediaUrl: 'https://fb/doc.pdf' }),
    });
  });

  it('batch: 2 different accounts in one payload', async () => {
    mocks.db.metaAccount.findFirst
      .mockResolvedValueOnce(FB_ACCOUNT)
      .mockResolvedValueOnce({ ...FB_ACCOUNT, id: 'meta-2', pageId: 'page-999' });
    mocks.db.chatThread.findFirst.mockResolvedValue(null);
    mocks.db.chatThread.create
      .mockResolvedValueOnce({ id: 't1' })
      .mockResolvedValueOnce({ id: 't2' });

    const result = await handleMetaWebhook({
      object: 'page',
      entry: [
        { id: 'page-123', messaging: [{ sender: { id: 'u1' }, recipient: { id: 'page-123' }, message: { mid: 'm1', text: 'a' } }] },
        { id: 'page-999', messaging: [{ sender: { id: 'u2' }, recipient: { id: 'page-999' }, message: { mid: 'm2', text: 'b' } }] },
      ],
    });

    expect(result.processed).toBe(2);
  });

  it('empty entry.messaging -> processed=0', async () => {
    mocks.db.metaAccount.findFirst.mockResolvedValue(FB_ACCOUNT);
    const result = await handleMetaWebhook({
      object: 'page',
      entry: [{ id: 'page-123', messaging: [] }],
    });
    expect(result.processed).toBe(0);
  });

  it('payload.entry not array -> 0/0 without throw', async () => {
    const result = await handleMetaWebhook({
      object: 'page',
      // @ts-expect-error invalid payload on purpose
      entry: null,
    });
    expect(result).toEqual({ processed: 0, skipped: 0 });
  });
});
