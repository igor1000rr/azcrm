// Integration: settings/funnels — все 8 функций
import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = ReturnType<typeof vi.fn>;

const mockDb = {
  funnel: { create: vi.fn() as AnyFn, update: vi.fn() as AnyFn, delete: vi.fn() as AnyFn },
  stage:  {
    findUnique: vi.fn() as AnyFn, create: vi.fn() as AnyFn,
    update: vi.fn() as AnyFn, updateMany: vi.fn() as AnyFn, delete: vi.fn() as AnyFn,
  },
  documentTemplate: { create: vi.fn() as AnyFn, update: vi.fn() as AnyFn, delete: vi.fn() as AnyFn },
  lead:  { count: vi.fn() as AnyFn },
  $transaction: vi.fn(async (arg: unknown) => Array.isArray(arg) ? Promise.all(arg) : arg) as AnyFn,
};
const mockRequireAdmin = vi.fn(async () => ({ id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN' }));

vi.mock('@/lib/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN' })),
  requireAdmin: mockRequireAdmin,
}));

const {
  upsertFunnel, deleteFunnel, toggleFunnel,
  upsertStage, deleteStage, reorderStages,
  upsertDocTemplate, deleteDocTemplate,
} = await import('@/app/(app)/settings/funnels/actions');

beforeEach(() => {
  Object.values(mockDb).forEach((entity) => {
    if (typeof entity === 'function') (entity as AnyFn).mockReset();
    else Object.values(entity).forEach((fn) => (fn as AnyFn).mockReset());
  });
  mockDb.$transaction.mockImplementation(async (arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : arg,
  );
  mockRequireAdmin.mockReset();
  mockRequireAdmin.mockImplementation(async () => ({ id: 'u-admin', email: 'a@a', name: 'A', role: 'ADMIN' }));
});

describe('upsertFunnel', () => {
  it('zod: пустое name → throw', async () => {
    await expect(upsertFunnel({ name: '' } as never)).rejects.toThrow();
  });
  it('создание новой → funnel.create + 4 базовых этапа', async () => {
    mockDb.funnel.create.mockResolvedValue({ id: 'f-new' });
    const r = await upsertFunnel({ name: 'ПОБЫТ' } as never);
    expect(r).toEqual({ id: 'f-new' });
    const call = mockDb.funnel.create.mock.calls[0][0];
    expect(call.data.stages.create).toHaveLength(4);
    const names = call.data.stages.create.map((s: { name: string }) => s.name);
    expect(names).toEqual(['Новый', 'В работе', 'Завершён', 'Отказ']);
  });
  it('обновление (с id) → update, без создания этапов', async () => {
    await upsertFunnel({ id: 'f-1', name: 'New' } as never);
    expect(mockDb.funnel.update).toHaveBeenCalled();
    expect(mockDb.funnel.create).not.toHaveBeenCalled();
  });
  it('не-админ → throw', async () => {
    mockRequireAdmin.mockImplementation(async () => { throw new Error('Forbidden'); });
    await expect(upsertFunnel({ name: 'X' } as never)).rejects.toThrow();
  });
});

describe('deleteFunnel', () => {
  it('есть активные лиды → throw с числом лидов', async () => {
    mockDb.lead.count.mockResolvedValue(7);
    await expect(deleteFunnel('f-1')).rejects.toThrow(/7 активн/);
    expect(mockDb.funnel.delete).not.toHaveBeenCalled();
  });
  it('лидов нет → удаляет', async () => {
    mockDb.lead.count.mockResolvedValue(0);
    await deleteFunnel('f-1');
    expect(mockDb.funnel.delete).toHaveBeenCalledWith({ where: { id: 'f-1' } });
  });
});

describe('toggleFunnel', () => {
  it('переключает isActive', async () => {
    await toggleFunnel('f-1', false);
    expect(mockDb.funnel.update).toHaveBeenCalledWith({
      where: { id: 'f-1' }, data: { isActive: false },
    });
  });
});

describe('upsertStage', () => {
  it('zod: пустое name → throw', async () => {
    await expect(upsertStage({ funnelId: 'f-1', name: '', position: 0 } as never)).rejects.toThrow();
  });
  it('обновление (с id) → update, без updateMany', async () => {
    await upsertStage({ id: 's-1', funnelId: 'f-1', name: 'X', position: 2 } as never);
    expect(mockDb.stage.update).toHaveBeenCalled();
    expect(mockDb.stage.updateMany).not.toHaveBeenCalled();
  });
  it('создание → сдвиг существующих (updateMany position increment) + create', async () => {
    await upsertStage({ funnelId: 'f-1', name: 'New stage', position: 2 } as never);
    expect(mockDb.stage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { funnelId: 'f-1', position: { gte: 2 } },
        data: { position: { increment: 1 } },
      }),
    );
    expect(mockDb.stage.create).toHaveBeenCalled();
  });
});

describe('deleteStage', () => {
  it('есть лиды на этапе → throw с числом', async () => {
    mockDb.stage.findUnique.mockResolvedValue({ id: 's-1', _count: { leads: 5 } });
    await expect(deleteStage('s-1')).rejects.toThrow(/5 лидов/);
    expect(mockDb.stage.delete).not.toHaveBeenCalled();
  });
  it('лидов нет → удаляет', async () => {
    mockDb.stage.findUnique.mockResolvedValue({ id: 's-1', _count: { leads: 0 } });
    await deleteStage('s-1');
    expect(mockDb.stage.delete).toHaveBeenCalledWith({ where: { id: 's-1' } });
  });
  it('этап не найден → throw', async () => {
    mockDb.stage.findUnique.mockResolvedValue(null);
    await expect(deleteStage('s-x')).rejects.toThrow('Этап не найден');
  });
});

describe('reorderStages', () => {
  it('$transaction с N stage.update, position = idx+1', async () => {
    await reorderStages('f-1', ['s-3', 's-1', 's-2']);
    expect(mockDb.$transaction).toHaveBeenCalled();
    // внутри было 3 update'a
    expect(mockDb.stage.update).toHaveBeenCalledTimes(3);
  });
});

describe('upsertDocTemplate / deleteDocTemplate', () => {
  it('создание шаблона → create', async () => {
    await upsertDocTemplate({ funnelId: 'f-1', name: 'Паспорт', position: 0 } as never);
    expect(mockDb.documentTemplate.create).toHaveBeenCalled();
  });
  it('обновление → update, не create', async () => {
    await upsertDocTemplate({ id: 'd-1', funnelId: 'f-1', name: 'X', position: 1 } as never);
    expect(mockDb.documentTemplate.update).toHaveBeenCalled();
    expect(mockDb.documentTemplate.create).not.toHaveBeenCalled();
  });
  it('удаление шаблона', async () => {
    await deleteDocTemplate('d-1');
    expect(mockDb.documentTemplate.delete).toHaveBeenCalledWith({ where: { id: 'd-1' } });
  });
});
