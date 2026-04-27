// Интеграционный тест upsertWorkLog/deleteWorkLog
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = {
  workLog: { upsert: vi.fn(), deleteMany: vi.fn() },
};

const requireUserMock = vi.fn();

vi.mock('@/lib/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth', () => ({ requireUser: requireUserMock }));
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }));

const { upsertWorkLog, deleteWorkLog } = await import('@/app/(app)/work-calendar/actions');

beforeEach(() => {
  mockDb.workLog.upsert.mockReset();
  mockDb.workLog.deleteMany.mockReset();
  requireUserMock.mockReset();
  requireUserMock.mockResolvedValue({
    id: 'u-self', email: 's@s', name: 'S', role: 'SALES',
  });
});

describe('upsertWorkLog', () => {
  it('сотрудник пишет себе — успешно, hours считается', async () => {
    mockDb.workLog.upsert.mockResolvedValue({});

    await upsertWorkLog({
      date: '2026-04-27', startTime: '09:00', endTime: '18:00',
    });

    const call = mockDb.workLog.upsert.mock.calls[0][0];
    expect(call.where.userId_date.userId).toBe('u-self');
    expect(call.create.hours).toBe(9);
  });

  it('сотрудник пытается записать чужие часы → 403', async () => {
    await expect(upsertWorkLog({
      userId: 'u-other', date: '2026-04-27',
      startTime: '09:00', endTime: '18:00',
    })).rejects.toThrow();
  });

  it('admin может записать чужие часы', async () => {
    requireUserMock.mockResolvedValue({
      id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN',
    });
    mockDb.workLog.upsert.mockResolvedValue({});

    await upsertWorkLog({
      userId: 'u-other', date: '2026-04-27',
      startTime: '08:00', endTime: '17:30',
    });

    const call = mockDb.workLog.upsert.mock.calls[0][0];
    expect(call.where.userId_date.userId).toBe('u-other');
    expect(call.create.hours).toBe(9.5);
  });

  it('конец раньше начала → ошибка', async () => {
    await expect(upsertWorkLog({
      date: '2026-04-27', startTime: '18:00', endTime: '09:00',
    })).rejects.toThrow(/позже начала/);
  });

  it('zod: невалидный формат времени → ошибка', async () => {
    await expect(upsertWorkLog({
      date: '2026-04-27', startTime: 'abc', endTime: '18:00',
    })).rejects.toThrow();
  });
});

describe('deleteWorkLog', () => {
  it('сотрудник удаляет свой лог', async () => {
    mockDb.workLog.deleteMany.mockResolvedValue({ count: 1 });
    await deleteWorkLog('2026-04-27');
    expect(mockDb.workLog.deleteMany).toHaveBeenCalled();
  });

  it('сотрудник пытается удалить чужой → 403', async () => {
    await expect(deleteWorkLog('2026-04-27', 'u-other')).rejects.toThrow();
  });
});
