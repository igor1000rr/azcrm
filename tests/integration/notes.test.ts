// Интеграционные тесты addNote — парсинг @упоминаний + notify.
import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = ReturnType<typeof vi.fn>;

const mockDb = {
  lead:      { findUnique: vi.fn() as AnyFn },
  user:      { findMany:   vi.fn() as AnyFn },
  note:      { create:     vi.fn() as AnyFn },
  leadEvent: { create:     vi.fn() as AnyFn },
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: typeof mockDb) => Promise<unknown>)(mockDb);
    if (Array.isArray(arg)) return Promise.all(arg);
  }) as AnyFn,
};

const mockNotify = vi.fn();
const mockCanEditLead = vi.fn(() => true);

vi.mock('@/lib/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth', () => ({
  requireUser:  vi.fn(async () => ({ id: 'u-author', email: 'auth@a', name: 'Author', role: 'SALES' })),
  requireAdmin: vi.fn(async () => ({ id: 'u-author', email: 'auth@a', name: 'Author', role: 'ADMIN' })),
}));
vi.mock('@/lib/permissions', () => ({
  canEditLead:           mockCanEditLead,
  canTransferLead:       vi.fn(() => true),
  canAssignLegalManager: vi.fn(() => true),
  canDeletePayment:      vi.fn(() => true),
  assert: vi.fn((cond: boolean) => {
    if (!cond) throw new Error('Forbidden');
  }),
}));
vi.mock('@/lib/audit',  () => ({ audit:  vi.fn() }));
vi.mock('@/lib/notify', () => ({ notify: mockNotify }));

const { addNote } = await import('@/app/(app)/actions');

beforeEach(() => {
  mockDb.lead.findUnique.mockReset();
  mockDb.user.findMany.mockReset();
  mockDb.note.create.mockReset();
  mockDb.leadEvent.create.mockReset();
  mockDb.$transaction.mockReset();
  mockDb.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: typeof mockDb) => Promise<unknown>)(mockDb);
    if (Array.isArray(arg)) return Promise.all(arg);
  });
  mockNotify.mockReset();
  mockCanEditLead.mockReset();
  mockCanEditLead.mockReturnValue(true);
});

describe('addNote', () => {
  it('пустой body → zod throw', async () => {
    await expect(addNote({ leadId: 'l-1', body: '' })).rejects.toThrow();
  });

  it('лид не найден → throw', async () => {
    mockDb.lead.findUnique.mockResolvedValue(null);
    await expect(addNote({ leadId: 'no-such', body: 'hi' })).rejects.toThrow('Лид не найден');
  });

  it('canEditLead=false → throw', async () => {
    mockDb.lead.findUnique.mockResolvedValue({ id: 'l-1', salesManagerId: 'u-other', legalManagerId: null });
    mockCanEditLead.mockReturnValue(false);
    await expect(addNote({ leadId: 'l-1', body: 'hi' })).rejects.toThrow();
    expect(mockDb.note.create).not.toHaveBeenCalled();
  });

  it('без упоминаний: заметка создаётся, notify не вызывается', async () => {
    mockDb.lead.findUnique.mockResolvedValue({ id: 'l-1', salesManagerId: 'u-author', legalManagerId: null });
    // С mentions=[] db.user.findMany не вызывается вообще
    await addNote({ leadId: 'l-1', body: 'Простая заметка без упоминаний' });

    expect(mockDb.note.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leadId: 'l-1', authorId: 'u-author', mentions: [],
        }),
      }),
    );
    expect(mockDb.leadEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'NOTE_ADDED' }),
      }),
    );
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('@упоминания: парсятся и notify вызывается для каждого кроме автора', async () => {
    mockDb.lead.findUnique.mockResolvedValue({ id: 'l-1', salesManagerId: 'u-author', legalManagerId: null });
    mockDb.user.findMany.mockResolvedValue([
      { id: 'u-bob' },
      { id: 'u-alice' },
      { id: 'u-author' }, // сами себя
    ]);

    await addNote({
      leadId: 'l-1',
      body:   '@bob @alice @author посмотрите пожалуйста',
    });

    // Нота сохранилась с mentions всех найденных
    const noteCall = mockDb.note.create.mock.calls[0][0];
    expect(noteCall.data.mentions).toEqual(['u-bob', 'u-alice', 'u-author']);

    // notify вызван только для bob и alice (не для себя)
    expect(mockNotify).toHaveBeenCalledTimes(2);
    const ids = mockNotify.mock.calls.map((c) => (c[0] as { userId: string }).userId).sort();
    expect(ids).toEqual(['u-alice', 'u-bob']);
  });

  it('@упоминание несуществующего юзера — не ломает (notify не вызывается)', async () => {
    mockDb.lead.findUnique.mockResolvedValue({ id: 'l-1', salesManagerId: 'u-author', legalManagerId: null });
    mockDb.user.findMany.mockResolvedValue([]); // никто не нашёлся

    await addNote({ leadId: 'l-1', body: '@phantom @ghost вы где?' });

    expect(mockDb.note.create).toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('без @ в тексте: db.user.findMany не вызывается вообще (оптимизация)', async () => {
    mockDb.lead.findUnique.mockResolvedValue({ id: 'l-1', salesManagerId: 'u-author', legalManagerId: null });

    await addNote({ leadId: 'l-1', body: 'Простой текст без упоминаний' });

    expect(mockDb.user.findMany).not.toHaveBeenCalled();
  });
});
