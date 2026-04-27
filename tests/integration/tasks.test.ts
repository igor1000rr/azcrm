// Integration: tasks/actions — upsertTask + setTaskStatus + deleteTask
import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = ReturnType<typeof vi.fn>;

const mockDb = {
  task:      { findUnique: vi.fn() as AnyFn, create: vi.fn() as AnyFn, update: vi.fn() as AnyFn, delete: vi.fn() as AnyFn },
  leadEvent: { create: vi.fn() as AnyFn },
};
const mockNotify = vi.fn();
const mockRequireUser = vi.fn(async () => ({
  id: 'u-1', email: 'u@a', name: 'Ivan', role: 'SALES',
}));

vi.mock('@/lib/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth', () => ({
  requireUser: mockRequireUser,
  requireAdmin: vi.fn(async () => ({ id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN' })),
}));
vi.mock('@/lib/notify', () => ({ notify: mockNotify }));

const { upsertTask, setTaskStatus, deleteTask } = await import('@/app/(app)/tasks/actions');

beforeEach(() => {
  Object.values(mockDb).forEach((entity) => Object.values(entity).forEach((fn) => (fn as AnyFn).mockReset()));
  mockNotify.mockReset();
  mockRequireUser.mockReset();
  mockRequireUser.mockImplementation(async () => ({ id: 'u-1', email: 'u@a', name: 'Ivan', role: 'SALES' }));
});

describe('upsertTask — создание', () => {
  it('zod: пустой title → throw', async () => {
    await expect(upsertTask({ title: '' } as never)).rejects.toThrow();
  });
  it('zod: invalid priority → throw', async () => {
    await expect(upsertTask({ title: 'X', priority: 'WHATEVER' } as never)).rejects.toThrow();
  });
  it('создание без leadId, без assignee → task.create, без notify, без leadEvent', async () => {
    mockDb.task.create.mockResolvedValue({ id: 't-new' });
    const r = await upsertTask({ title: 'Сделать X' } as never);
    expect(r).toEqual({ id: 't-new' });
    expect(mockDb.task.create).toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockDb.leadEvent.create).not.toHaveBeenCalled();
  });
  it('создание с leadId → leadEvent TASK_CREATED', async () => {
    mockDb.task.create.mockResolvedValue({ id: 't-new' });
    await upsertTask({ title: 'X', leadId: 'l-1' } as never);
    expect(mockDb.leadEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ leadId: 'l-1', kind: 'TASK_CREATED' }),
      }),
    );
  });
  it('создание с assigneeId отличным от user → notify TASK_ASSIGNED', async () => {
    mockDb.task.create.mockResolvedValue({ id: 't-new' });
    await upsertTask({ title: 'Задача', assigneeId: 'u-bob' } as never);
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-bob', kind: 'TASK_ASSIGNED', body: 'Задача' }),
    );
  });
  it('создание с assigneeId == user.id → NO notify (сам себе не уведомляем)', async () => {
    mockDb.task.create.mockResolvedValue({ id: 't-new' });
    await upsertTask({ title: 'X', assigneeId: 'u-1' } as never);
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe('upsertTask — обновление', () => {
  it('задача не найдена → throw', async () => {
    mockDb.task.findUnique.mockResolvedValue(null);
    await expect(upsertTask({ id: 't-x', title: 'X' } as never)).rejects.toThrow('Задача не найдена');
  });
  it('не создатель и не исполнитель и не админ → throw', async () => {
    mockDb.task.findUnique.mockResolvedValue({ creatorId: 'other', assigneeId: 'other2' });
    await expect(upsertTask({ id: 't-1', title: 'X' } as never))
      .rejects.toThrow('Недостаточно прав');
  });
  it('ADMIN может редактировать чужую задачу', async () => {
    mockRequireUser.mockImplementation(async () => ({ id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN' }));
    mockDb.task.findUnique.mockResolvedValue({ creatorId: 'other', assigneeId: 'other2' });
    await upsertTask({ id: 't-1', title: 'X' } as never);
    expect(mockDb.task.update).toHaveBeenCalled();
  });
  it('смена assignee на нового (не self) → notify', async () => {
    mockDb.task.findUnique.mockResolvedValue({ creatorId: 'u-1', assigneeId: 'u-old' });
    await upsertTask({ id: 't-1', title: 'X', assigneeId: 'u-new' } as never);
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-new', kind: 'TASK_ASSIGNED' }),
    );
  });
  it('смена assignee на того же → NO notify', async () => {
    mockDb.task.findUnique.mockResolvedValue({ creatorId: 'u-1', assigneeId: 'u-bob' });
    await upsertTask({ id: 't-1', title: 'X', assigneeId: 'u-bob' } as never);
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe('setTaskStatus', () => {
  it('задача не найдена → throw', async () => {
    mockDb.task.findUnique.mockResolvedValue(null);
    await expect(setTaskStatus('t-x', 'DONE')).rejects.toThrow('Не найдено');
  });
  it('нет прав (чужая задача) → throw', async () => {
    mockDb.task.findUnique.mockResolvedValue({ creatorId: 'other', assigneeId: 'other2' });
    await expect(setTaskStatus('t-1', 'DONE')).rejects.toThrow('Недостаточно прав');
  });
  it('DONE → completedAt устанавливается', async () => {
    mockDb.task.findUnique.mockResolvedValue({ creatorId: 'u-1', assigneeId: null });
    await setTaskStatus('t-1', 'DONE');
    const call = mockDb.task.update.mock.calls[0][0];
    expect(call.data.completedAt).toBeInstanceOf(Date);
  });
  it('OPEN → completedAt = null', async () => {
    mockDb.task.findUnique.mockResolvedValue({ creatorId: 'u-1', assigneeId: null });
    await setTaskStatus('t-1', 'OPEN');
    const call = mockDb.task.update.mock.calls[0][0];
    expect(call.data.completedAt).toBeNull();
  });
  it('CANCELLED → completedAt = null', async () => {
    mockDb.task.findUnique.mockResolvedValue({ creatorId: 'u-1', assigneeId: null });
    await setTaskStatus('t-1', 'CANCELLED');
    const call = mockDb.task.update.mock.calls[0][0];
    expect(call.data.completedAt).toBeNull();
  });
  it('исполнитель (assignee == user) может менять статус', async () => {
    mockDb.task.findUnique.mockResolvedValue({ creatorId: 'other', assigneeId: 'u-1' });
    await setTaskStatus('t-1', 'DONE');
    expect(mockDb.task.update).toHaveBeenCalled();
  });
});

describe('deleteTask', () => {
  it('задача не найдена → throw', async () => {
    mockDb.task.findUnique.mockResolvedValue(null);
    await expect(deleteTask('t-x')).rejects.toThrow('Не найдено');
  });
  it('исполнитель (не создатель, не админ) НЕ может удалить', async () => {
    mockDb.task.findUnique.mockResolvedValue({ creatorId: 'other' });
    await expect(deleteTask('t-1')).rejects.toThrow('создатель или админ');
    expect(mockDb.task.delete).not.toHaveBeenCalled();
  });
  it('создатель может удалить', async () => {
    mockDb.task.findUnique.mockResolvedValue({ creatorId: 'u-1' });
    await deleteTask('t-1');
    expect(mockDb.task.delete).toHaveBeenCalledWith({ where: { id: 't-1' } });
  });
  it('ADMIN может удалить чужую', async () => {
    mockRequireUser.mockImplementation(async () => ({ id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN' }));
    mockDb.task.findUnique.mockResolvedValue({ creatorId: 'other' });
    await deleteTask('t-1');
    expect(mockDb.task.delete).toHaveBeenCalled();
  });
});
