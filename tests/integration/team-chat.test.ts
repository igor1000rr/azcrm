// Интеграционные тесты team-chat actions: openDirectChat, createGroupChat, sendTeamChatMessage.
import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = ReturnType<typeof vi.fn>;

const mockDb = {
  teamChat:        { findFirst: vi.fn() as AnyFn, create: vi.fn() as AnyFn, update: vi.fn() as AnyFn },
  teamChatMember:  {
    findUnique: vi.fn() as AnyFn,
    findMany:   vi.fn() as AnyFn,
    updateMany: vi.fn() as AnyFn,
  },
  teamChatMessage: { create: vi.fn() as AnyFn },
  notification:    { createMany: vi.fn() as AnyFn },
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: typeof mockDb) => Promise<unknown>)(mockDb);
    if (Array.isArray(arg)) return Promise.all(arg);
  }) as AnyFn,
};

vi.mock('@/lib/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth', () => ({
  requireUser:  vi.fn(async () => ({ id: 'u-1', email: 'u@a', name: 'U', role: 'SALES' })),
  requireAdmin: vi.fn(async () => ({ id: 'u-1', email: 'u@a', name: 'U', role: 'ADMIN' })),
}));

const { openDirectChat, createGroupChat, sendTeamChatMessage } =
  await import('@/app/(app)/team-chat/actions');

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
  // По умолчанию teamChatMember.findMany возвращает пустой список
  // (для итерации .map в sendTeamChatMessage).
  mockDb.teamChatMember.findMany.mockResolvedValue([]);
});

describe('openDirectChat', () => {
  it('нельзя писать самому себе', async () => {
    await expect(openDirectChat('u-1')).rejects.toThrow('самому себе');
    expect(mockDb.teamChat.create).not.toHaveBeenCalled();
  });

  it('существующий DIRECT с двумя members — возвращаем его id', async () => {
    mockDb.teamChat.findFirst.mockResolvedValue({
      id: 'c-existing',
      members: [{ userId: 'u-1' }, { userId: 'u-2' }],
    });

    const res = await openDirectChat('u-2');
    expect(res.chatId).toBe('c-existing');
    expect(mockDb.teamChat.create).not.toHaveBeenCalled();
  });

  it('нет существующего → создаётся новый с 2 members', async () => {
    mockDb.teamChat.findFirst.mockResolvedValue(null);
    mockDb.teamChat.create.mockResolvedValue({ id: 'c-new' });

    const res = await openDirectChat('u-2');
    expect(res.chatId).toBe('c-new');
    expect(mockDb.teamChat.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'DIRECT',
          members: { create: [{ userId: 'u-1' }, { userId: 'u-2' }] },
        }),
      }),
    );
  });
});

describe('createGroupChat', () => {
  it('пустое name → zod throw', async () => {
    await expect(createGroupChat({ name: '', memberIds: ['u-2'] }))
      .rejects.toThrow();
  });

  it('пустой memberIds → zod throw', async () => {
    await expect(createGroupChat({ name: 'Group', memberIds: [] }))
      .rejects.toThrow();
  });

  it('автор включён в members даже если не указан', async () => {
    mockDb.teamChat.create.mockResolvedValue({ id: 'g-1' });
    await createGroupChat({ name: 'Team', memberIds: ['u-2', 'u-3'] });

    const call = mockDb.teamChat.create.mock.calls[0][0];
    const userIds = call.data.members.create.map((m: { userId: string }) => m.userId);
    expect(userIds).toEqual(expect.arrayContaining(['u-1', 'u-2', 'u-3']));
  });

  it('дубликаты memberIds дедуплицируются', async () => {
    mockDb.teamChat.create.mockResolvedValue({ id: 'g-2' });
    await createGroupChat({ name: 'T', memberIds: ['u-2', 'u-2', 'u-1'] });

    const call = mockDb.teamChat.create.mock.calls[0][0];
    const userIds = call.data.members.create.map((m: { userId: string }) => m.userId);
    expect(userIds).toHaveLength(2); // u-1 + u-2
  });

  it('name больше 80 символов → throw', async () => {
    await expect(createGroupChat({ name: 'a'.repeat(81), memberIds: ['u-2'] }))
      .rejects.toThrow();
  });
});

describe('sendTeamChatMessage', () => {
  it('пустое body → zod throw', async () => {
    await expect(sendTeamChatMessage({ chatId: 'c-1', body: '' })).rejects.toThrow();
  });

  it('body > 5000 символов → throw', async () => {
    await expect(sendTeamChatMessage({ chatId: 'c-1', body: 'a'.repeat(5001) }))
      .rejects.toThrow();
  });

  it('юзер не участник чата → throw, сообщение не создаётся', async () => {
    mockDb.teamChatMember.findUnique.mockResolvedValue(null);

    await expect(sendTeamChatMessage({ chatId: 'c-1', body: 'hi' }))
      .rejects.toThrow('Не участник');
    expect(mockDb.teamChatMessage.create).not.toHaveBeenCalled();
  });

  it('участник: сообщение создаётся + chat обновляет lastMessageAt + lastReadAt автора', async () => {
    mockDb.teamChatMember.findUnique.mockResolvedValue({
      chatId: 'c-1', userId: 'u-1',
    });

    await sendTeamChatMessage({ chatId: 'c-1', body: 'hello team' });

    expect(mockDb.teamChatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          chatId:   'c-1',
          authorId: 'u-1',
          body:     'hello team',
        }),
      }),
    );
    expect(mockDb.teamChat.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c-1' },
        data:  expect.objectContaining({ lastMessageAt: expect.any(Date) }),
      }),
    );
    // Автор помечается как прочитавший
    expect(mockDb.teamChatMember.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { chatId: 'c-1', userId: 'u-1' },
        data:  expect.objectContaining({ lastReadAt: expect.any(Date) }),
      }),
    );
  });

  it('уведомления остальным участникам чата через notification.createMany', async () => {
    mockDb.teamChatMember.findUnique.mockResolvedValue({ chatId: 'c-1', userId: 'u-1' });
    mockDb.teamChatMember.findMany.mockResolvedValue([
      { userId: 'u-bob' },
      { userId: 'u-alice' },
    ]);

    await sendTeamChatMessage({ chatId: 'c-1', body: 'hi all' });

    expect(mockDb.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ userId: 'u-bob',   kind: 'NEW_MESSAGE' }),
          expect.objectContaining({ userId: 'u-alice', kind: 'NEW_MESSAGE' }),
        ]),
      }),
    );
  });

  it('нет других участников → notification.createMany вызывается с пустым массивом', async () => {
    mockDb.teamChatMember.findUnique.mockResolvedValue({ chatId: 'c-1', userId: 'u-1' });
    mockDb.teamChatMember.findMany.mockResolvedValue([]); // нет других

    await sendTeamChatMessage({ chatId: 'c-1', body: 'solo' });

    expect(mockDb.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [] }),
    );
  });
});
