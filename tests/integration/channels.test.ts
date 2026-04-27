// Integration: settings/channels — upsert + delete + toggle WhatsApp аккаунты
import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = ReturnType<typeof vi.fn>;

const mockDb = {
  whatsappAccount: {
    create: vi.fn() as AnyFn, update: vi.fn() as AnyFn, delete: vi.fn() as AnyFn,
  },
};
const mockWorkerDisconnect = vi.fn();
const mockRequireAdmin = vi.fn(async () => ({ id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN' }));

vi.mock('@/lib/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN' })),
  requireAdmin: mockRequireAdmin,
}));
vi.mock('@/lib/whatsapp', () => ({ workerDisconnect: mockWorkerDisconnect }));

const { upsertWhatsappAccount, deleteWhatsappAccount, toggleWhatsappAccount } =
  await import('@/app/(app)/settings/channels/actions');

beforeEach(() => {
  Object.values(mockDb.whatsappAccount).forEach((fn) => (fn as AnyFn).mockReset());
  mockWorkerDisconnect.mockReset();
  mockRequireAdmin.mockReset();
  mockRequireAdmin.mockImplementation(async () => ({ id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN' }));
});

describe('upsertWhatsappAccount', () => {
  it('zod: пустой label → throw', async () => {
    await expect(upsertWhatsappAccount({ phoneNumber: '+48123456789', label: '' } as never))
      .rejects.toThrow();
  });
  it('zod: телефон короче 5 символов → throw', async () => {
    await expect(upsertWhatsappAccount({ phoneNumber: '123', label: 'X' } as never))
      .rejects.toThrow();
  });
  it('создание → normalizePhone + create с isActive=true', async () => {
    await upsertWhatsappAccount({ phoneNumber: '+48 123 456 789', label: 'Anna' } as never);
    const call = mockDb.whatsappAccount.create.mock.calls[0][0];
    // Пробелы убираются normalizePhone
    expect(call.data.phoneNumber).not.toMatch(/\s/);
    expect(call.data.isActive).toBe(true);
    expect(call.data.label).toBe('Anna');
  });
  it('обновление → update, не create', async () => {
    await upsertWhatsappAccount({ id: 'wa-1', phoneNumber: '+48123456789', label: 'X' } as never);
    expect(mockDb.whatsappAccount.update).toHaveBeenCalled();
    expect(mockDb.whatsappAccount.create).not.toHaveBeenCalled();
  });
});

describe('deleteWhatsappAccount', () => {
  it('вызывает workerDisconnect ПЕРЕД удалением из БД', async () => {
    const order: string[] = [];
    mockWorkerDisconnect.mockImplementation(async () => { order.push('worker'); });
    mockDb.whatsappAccount.delete.mockImplementation(async () => { order.push('db'); });
    await deleteWhatsappAccount('wa-1');
    expect(order).toEqual(['worker', 'db']);
  });
  it('workerDisconnect бросил исключение → всё равно удаляет из БД', async () => {
    mockWorkerDisconnect.mockRejectedValue(new Error('worker offline'));
    await deleteWhatsappAccount('wa-1');
    expect(mockDb.whatsappAccount.delete).toHaveBeenCalledWith({ where: { id: 'wa-1' } });
  });
});

describe('toggleWhatsappAccount', () => {
  it('переключает isActive', async () => {
    await toggleWhatsappAccount('wa-1', false);
    expect(mockDb.whatsappAccount.update).toHaveBeenCalledWith({
      where: { id: 'wa-1' }, data: { isActive: false },
    });
  });
  it('не-админ → throw', async () => {
    mockRequireAdmin.mockImplementation(async () => { throw new Error('Forbidden'); });
    await expect(toggleWhatsappAccount('wa-1', true)).rejects.toThrow();
  });
});
