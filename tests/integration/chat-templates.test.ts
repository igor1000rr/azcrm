// Integration: settings/chat-templates — upsert + delete
import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = ReturnType<typeof vi.fn>;

const mockDb = {
  chatTemplate: { create: vi.fn() as AnyFn, update: vi.fn() as AnyFn, delete: vi.fn() as AnyFn },
};
const mockRequireAdmin = vi.fn(async () => ({ id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN' }));

vi.mock('@/lib/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN' })),
  requireAdmin: mockRequireAdmin,
}));

const { upsertChatTemplate, deleteChatTemplate } =
  await import('@/app/(app)/settings/chat-templates/actions');

beforeEach(() => {
  Object.values(mockDb.chatTemplate).forEach((fn) => (fn as AnyFn).mockReset());
  mockRequireAdmin.mockReset();
  mockRequireAdmin.mockImplementation(async () => ({ id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN' }));
});

describe('upsertChatTemplate', () => {
  it('zod: пустое name → throw', async () => {
    await expect(upsertChatTemplate({ name: '', body: 'x' } as never)).rejects.toThrow();
  });
  it('zod: пустое body → throw', async () => {
    await expect(upsertChatTemplate({ name: 'X', body: '' } as never)).rejects.toThrow();
  });
  it('zod: name > 120 символов → throw', async () => {
    await expect(upsertChatTemplate({ name: 'a'.repeat(121), body: 'x' } as never))
      .rejects.toThrow();
  });
  it('создание без id → create', async () => {
    await upsertChatTemplate({ name: 'Privet', body: 'Добрый день!', category: 'Приветствия' } as never);
    expect(mockDb.chatTemplate.create).toHaveBeenCalled();
  });
  it('обновление с id → update', async () => {
    await upsertChatTemplate({ id: 't-1', name: 'X', body: 'Y' } as never);
    expect(mockDb.chatTemplate.update).toHaveBeenCalled();
    expect(mockDb.chatTemplate.create).not.toHaveBeenCalled();
  });
  it('пустая category → в БД null', async () => {
    await upsertChatTemplate({ name: 'X', body: 'Y', category: '' } as never);
    const call = mockDb.chatTemplate.create.mock.calls[0][0];
    expect(call.data.category).toBeNull();
  });
  it('не-админ → throw', async () => {
    mockRequireAdmin.mockImplementation(async () => { throw new Error('Forbidden'); });
    await expect(upsertChatTemplate({ name: 'X', body: 'Y' } as never)).rejects.toThrow();
  });
});

describe('deleteChatTemplate', () => {
  it('удаляет из БД', async () => {
    await deleteChatTemplate('t-5');
    expect(mockDb.chatTemplate.delete).toHaveBeenCalledWith({ where: { id: 't-5' } });
  });
  it('не-админ → throw', async () => {
    mockRequireAdmin.mockImplementation(async () => { throw new Error('Forbidden'); });
    await expect(deleteChatTemplate('t-5')).rejects.toThrow();
    expect(mockDb.chatTemplate.delete).not.toHaveBeenCalled();
  });
});
