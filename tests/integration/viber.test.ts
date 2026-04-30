// Unit + Integration: lib/viber
// Anna идея №22 — Viber канал.
// Покрывает: verifyViberSignature (HMAC, timing-safe), handleViberEvent
// (создание thread/message, типы media, обновление счётчиков).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// ============================================================
// Unit: verifyViberSignature
// ============================================================

import { verifyViberSignature } from '@/lib/viber';

describe('verifyViberSignature', () => {
  const TOKEN = 'test-viber-auth-token';
  const BODY  = '{"event":"message","sender":{"id":"u1"}}';

  function sign(token: string, body: string): string {
    return crypto.createHmac('sha256', token).update(body).digest('hex');
  }

  it('валидная подпись → true', () => {
    expect(verifyViberSignature(TOKEN, BODY, sign(TOKEN, BODY))).toBe(true);
  });

  it('неверный токен → false', () => {
    expect(verifyViberSignature(TOKEN, BODY, sign('wrong-token', BODY))).toBe(false);
  });

  it('изменён body → false', () => {
    expect(verifyViberSignature(TOKEN, BODY + ' tampered', sign(TOKEN, BODY))).toBe(false);
  });

  it('пустая подпись → false', () => {
    expect(verifyViberSignature(TOKEN, BODY, '')).toBe(false);
  });

  it('пустой токен → false', () => {
    expect(verifyViberSignature('', BODY, sign(TOKEN, BODY))).toBe(false);
  });

  it('подпись нечётной длины (битый hex) → false без throw', () => {
    expect(verifyViberSignature(TOKEN, BODY, 'abc')).toBe(false);
  });

  it('подпись правильной длины но мусорный hex → false без throw', () => {
    const fake = '0'.repeat(64);
    expect(verifyViberSignature(TOKEN, BODY, fake)).toBe(false);
  });

  it('signature длиной отличной от 32 байт → false (не 64 hex chars)', () => {
    expect(verifyViberSignature(TOKEN, BODY, 'aa'.repeat(20))).toBe(false);
  });
});

// ============================================================
// Integration: handleViberEvent (с моком db)
// ============================================================

const mocks = vi.hoisted(() => ({
  db: {
    chatThread: {
      findFirst: vi.fn(),
      create:    vi.fn(),
      update:    vi.fn(),
    },
    chatMessage: {
      create: vi.fn(),
    },
    viberAccount: {
      update: vi.fn(),
    },
  },
}));

vi.mock('@/lib/db', () => ({ db: mocks.db }));

const { handleViberEvent } = await import('@/lib/viber');

const ACCOUNT = {
  id:          'viber-acc-1',
  authToken:   't',
  paName:      'AZ Group',
  paUri:       null,
  label:       'AZ Viber',
  ownerId:     null,
  isConnected: true,
  isActive:    true,
  webhookUrl:  null,
  createdAt:   new Date(),
  updatedAt:   new Date(),
  lastSeenAt:  null,
};

beforeEach(() => {
  mocks.db.chatThread.findFirst.mockReset();
  mocks.db.chatThread.create.mockReset();
  mocks.db.chatThread.update.mockReset();
  mocks.db.chatMessage.create.mockReset();
  mocks.db.viberAccount.update.mockReset();

  mocks.db.chatThread.update.mockResolvedValue({});
  mocks.db.chatMessage.create.mockResolvedValue({});
  mocks.db.viberAccount.update.mockResolvedValue({});
});

describe('handleViberEvent', () => {
  it('event != message -> ignored', async () => {
    const r = await handleViberEvent(ACCOUNT, { event: 'subscribed', sender: { id: 'u1' } });
    expect(r.ok).toBe(true);
    expect(r.reason).toBe('ignored_subscribed');
    expect(mocks.db.chatThread.findFirst).not.toHaveBeenCalled();
  });

  it('нет sender -> ok=false с reason', async () => {
    const r = await handleViberEvent(ACCOUNT, {
      event: 'message',
      message: { type: 'text', text: 'hi' },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no_sender_or_message');
  });

  it('новый текстовый event -> создаёт thread и message', async () => {
    mocks.db.chatThread.findFirst.mockResolvedValue(null);
    mocks.db.chatThread.create.mockResolvedValue({ id: 'thread-1' });

    const r = await handleViberEvent(ACCOUNT, {
      event:   'message',
      message_token: 12345,
      sender:  { id: 'u-viber-1', name: 'Ivan' },
      message: { type: 'text', text: 'Hello' },
    });

    expect(r.ok).toBe(true);
    expect(mocks.db.chatThread.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        channel:          'VIBER',
        viberAccountId:   'viber-acc-1',
        externalId:       'u-viber-1',
        externalUserName: 'Ivan',
      }),
    });
    expect(mocks.db.chatMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        threadId:       'thread-1',
        viberAccountId: 'viber-acc-1',
        direction:      'IN',
        type:           'TEXT',
        body:           'Hello',
        externalId:     '12345',
      }),
    });
    expect(mocks.db.chatThread.update).toHaveBeenCalledWith({
      where: { id: 'thread-1' },
      data: expect.objectContaining({
        unreadCount:      { increment: 1 },
        lastMessageText:  'Hello',
        externalUserName: 'Ivan',
      }),
    });
  });

  it('существующий thread -> не создаёт новый', async () => {
    mocks.db.chatThread.findFirst.mockResolvedValue({ id: 'thread-existing' });

    await handleViberEvent(ACCOUNT, {
      event:   'message',
      sender:  { id: 'u-viber-1' },
      message: { type: 'text', text: 'hi' },
    });

    expect(mocks.db.chatThread.create).not.toHaveBeenCalled();
    expect(mocks.db.chatMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ threadId: 'thread-existing' }),
    });
  });

  it('picture -> type=IMAGE, mediaUrl сохраняется', async () => {
    mocks.db.chatThread.findFirst.mockResolvedValue({ id: 't1' });

    await handleViberEvent(ACCOUNT, {
      event:   'message',
      sender:  { id: 'u1' },
      message: { type: 'picture', media: 'https://viber/pic.jpg' },
    });

    expect(mocks.db.chatMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type:     'IMAGE',
        mediaUrl: 'https://viber/pic.jpg',
        body:     null,
      }),
    });
  });

  it('file -> type=DOCUMENT с file_name + file_size', async () => {
    mocks.db.chatThread.findFirst.mockResolvedValue({ id: 't1' });

    await handleViberEvent(ACCOUNT, {
      event:   'message',
      sender:  { id: 'u1' },
      message: { type: 'file', media: 'https://viber/doc.pdf', file_name: 'pass.pdf', file_size: 102400 },
    });

    expect(mocks.db.chatMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type:      'DOCUMENT',
        mediaUrl:  'https://viber/doc.pdf',
        mediaName: 'pass.pdf',
        mediaSize: 102400,
      }),
    });
  });

  it('contact -> body содержит name + phone', async () => {
    mocks.db.chatThread.findFirst.mockResolvedValue({ id: 't1' });

    await handleViberEvent(ACCOUNT, {
      event:   'message',
      sender:  { id: 'u1' },
      message: { type: 'contact', contact: { name: 'Anna', phone_number: '+48123' } },
    });

    expect(mocks.db.chatMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'CONTACT',
        body: 'Anna +48123',
      }),
    });
  });

  it('location -> type=LOCATION, body=[location]', async () => {
    mocks.db.chatThread.findFirst.mockResolvedValue({ id: 't1' });

    await handleViberEvent(ACCOUNT, {
      event:   'message',
      sender:  { id: 'u1' },
      message: { type: 'location' },
    });

    expect(mocks.db.chatMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'LOCATION',
        body: '[location]',
      }),
    });
  });

  it('lastSeenAt у аккаунта обновляется', async () => {
    mocks.db.chatThread.findFirst.mockResolvedValue({ id: 't1' });

    await handleViberEvent(ACCOUNT, {
      event:   'message',
      sender:  { id: 'u1' },
      message: { type: 'text', text: 'x' },
    });

    expect(mocks.db.viberAccount.update).toHaveBeenCalledWith({
      where: { id: 'viber-acc-1' },
      data:  { lastSeenAt: expect.any(Date) },
    });
  });
});
