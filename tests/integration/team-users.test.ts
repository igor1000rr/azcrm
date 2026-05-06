// Integration: settings/team — upsertUser + toggleActive + resetPassword
import { describe, it, expect, vi, beforeEach } from 'vitest';

type AnyFn = ReturnType<typeof vi.fn>;

const mockDb = {
  user: {
    findUnique: vi.fn() as AnyFn, count: vi.fn() as AnyFn,
    create: vi.fn() as AnyFn, update: vi.fn() as AnyFn,
  },
};
const mockAudit = vi.fn();
const mockBcryptHash = vi.fn(async (p: string) => `HASHED:${p}`);
const mockRequireAdmin = vi.fn(async () => ({ id: 'u-admin', email: 'admin@example.com', name: 'A', role: 'ADMIN' }));

vi.mock('@/lib/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ id: 'u-admin', email: 'admin@example.com', name: 'A', role: 'ADMIN' })),
  requireAdmin: mockRequireAdmin,
}));
vi.mock('@/lib/audit', () => ({ audit: mockAudit }));
vi.mock('bcryptjs', () => ({ default: { hash: mockBcryptHash }, hash: mockBcryptHash }));

const { upsertUser, toggleUserActive, resetUserPassword } =
  await import('@/app/(app)/settings/team/actions');

beforeEach(() => {
  Object.values(mockDb.user).forEach((fn) => (fn as AnyFn).mockReset());
  mockAudit.mockReset();
  mockBcryptHash.mockReset();
  mockBcryptHash.mockImplementation(async (p: string) => `HASHED:${p}`);
  mockRequireAdmin.mockReset();
  mockRequireAdmin.mockImplementation(async () => ({ id: 'u-admin', email: 'admin@example.com', name: 'A', role: 'ADMIN' }));
});

describe('upsertUser — создание', () => {
  it('zod: invalid email → throw', async () => {
    await expect(upsertUser({ email: 'not-email', name: 'Test', role: 'SALES', password: '123456' } as never))
      .rejects.toThrow();
  });
  it('zod: name <2 символов → throw', async () => {
    await expect(upsertUser({ email: 'test@example.com', name: 'A', role: 'SALES', password: '123456' } as never))
      .rejects.toThrow();
  });
  it('zod: invalid role → throw', async () => {
    await expect(upsertUser({ email: 'test@example.com', name: 'Test', role: 'GUEST', password: '123456' } as never))
      .rejects.toThrow();
  });
  it('создание без пароля → throw', async () => {
    await expect(upsertUser({ email: 'test@example.com', name: 'Test', role: 'SALES' } as never))
      .rejects.toThrow('Пароль должен');
  });
  it('создание с паролем <6 символов → throw', async () => {
    await expect(upsertUser({ email: 'test@example.com', name: 'Test', role: 'SALES', password: '12345' } as never))
      .rejects.toThrow('Пароль должен');
  });
  it('создание → bcrypt.hash + user.create + audit user.create', async () => {
    mockDb.user.create.mockResolvedValue({ id: 'u-new' });
    await upsertUser({
      email: 'NEW@User.com', name: 'New User', role: 'LEGAL', password: 'secret123',
    } as never);
    expect(mockBcryptHash).toHaveBeenCalledWith('secret123', 10);
    const call = mockDb.user.create.mock.calls[0][0];
    expect(call.data.email).toBe('new@user.com');
    expect(call.data.passwordHash).toBe('HASHED:secret123');
    // 06.05.2026: при создании нового юзера mustChangePassword=true (#91 аудита) —
    // чтобы admin не знал пароль навсегда, сотрудник обязан сменить при первом
    // входе.
    expect(call.data.mustChangePassword).toBe(true);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'user.create' }));
  });
});

describe('upsertUser — обновление', () => {
  it('без пароля → обновляет без passwordHash', async () => {
    await upsertUser({
      id: 'u-1', email: 'test@example.com', name: 'Test User', role: 'SALES',
    } as never);
    const call = mockDb.user.update.mock.calls[0][0];
    expect(call.data.passwordHash).toBeUndefined();
    // Без смены пароля флаг mustChangePassword не трогаем
    expect(call.data.mustChangePassword).toBeUndefined();
  });
  it('с паролем >=6 → хеширует и обновляет hash + ставит mustChangePassword', async () => {
    await upsertUser({
      id: 'u-1', email: 'test@example.com', name: 'Test User', role: 'SALES', password: 'newpass',
    } as never);
    expect(mockBcryptHash).toHaveBeenCalledWith('newpass', 10);
    const call = mockDb.user.update.mock.calls[0][0];
    expect(call.data.passwordHash).toBe('HASHED:newpass');
    // 06.05.2026 — пункт #32 аудита: при смене пароля admin'ом сотрудник
    // обязан сменить при следующем входе (admin не должен знать пароль).
    expect(call.data.mustChangePassword).toBe(true);
  });
  it('с коротким паролем (<6) → игнорируется при обновлении', async () => {
    await upsertUser({
      id: 'u-1', email: 'test@example.com', name: 'Test User', role: 'SALES', password: '12',
    } as never);
    expect(mockBcryptHash).not.toHaveBeenCalled();
    const call = mockDb.user.update.mock.calls[0][0];
    expect(call.data.passwordHash).toBeUndefined();
    // Пароль не менялся — флаг тоже не трогаем
    expect(call.data.mustChangePassword).toBeUndefined();
  });
});

describe('toggleUserActive', () => {
  it('активация — без проверки кол-ва админов', async () => {
    await toggleUserActive('u-1', true);
    expect(mockDb.user.findUnique).not.toHaveBeenCalled();
    expect(mockDb.user.update).toHaveBeenCalled();
  });
  it('деактивация не-админа — проверяет роль но не блокирует', async () => {
    mockDb.user.findUnique.mockResolvedValue({ role: 'SALES' });
    await toggleUserActive('u-1', false);
    expect(mockDb.user.update).toHaveBeenCalled();
  });
  it('деактивация единственного админа → throw', async () => {
    mockDb.user.findUnique.mockResolvedValue({ role: 'ADMIN' });
    mockDb.user.count.mockResolvedValue(1);
    await expect(toggleUserActive('u-admin', false))
      .rejects.toThrow('единственного администратора');
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });
  it('деактивация одного из нескольких админов → OK', async () => {
    mockDb.user.findUnique.mockResolvedValue({ role: 'ADMIN' });
    mockDb.user.count.mockResolvedValue(3);
    await toggleUserActive('u-1', false);
    expect(mockDb.user.update).toHaveBeenCalled();
  });
});

describe('resetUserPassword', () => {
  it('пароль <6 символов → throw', async () => {
    await expect(resetUserPassword('u-1', '123')).rejects.toThrow('Пароль должен');
    expect(mockBcryptHash).not.toHaveBeenCalled();
  });
  it('валидный пароль → hash + update + audit reset_password + mustChangePassword', async () => {
    await resetUserPassword('u-1', 'newSecret');
    expect(mockBcryptHash).toHaveBeenCalledWith('newSecret', 10);
    // 06.05.2026 — пункт #32 аудита: после reset'а пароля админом флаг
    // mustChangePassword=true. Сотрудник при следующем входе обязан
    // сменить — admin не должен знать пароль сотрудника.
    expect(mockDb.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u-1' },
        data: { passwordHash: 'HASHED:newSecret', mustChangePassword: true },
      }),
    );
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.reset_password', entityId: 'u-1' }),
    );
  });
  it('не-админ → throw', async () => {
    mockRequireAdmin.mockImplementation(async () => { throw new Error('Forbidden'); });
    await expect(resetUserPassword('u-1', 'newSecret')).rejects.toThrow();
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });
});
