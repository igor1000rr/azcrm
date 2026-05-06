// Integration: settings/team — upsertUser + toggleActive + resetPassword
//
// 06.05.2026 — пункт #33 аудита: минимум пароля унифицирован на 12 символов.
// До этого было min(6) в team/actions и min(8) в change-password.
// Тесты использовали 6-символьные пароли — обновлены на 12+.
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

// Пароли для тестов:
//   VALID_PASSWORD     — длины 12+, должен проходить валидацию
//   SHORT_PASSWORD     — любой < 12, должен быть отклонёным
const VALID_PASSWORD     = 'SecretPass123';   // 13 символов
const ANOTHER_VALID      = 'NewSecretPass1';  // 14 символов
const SHORT_PASSWORD_5   = '12345';
const SHORT_PASSWORD_2   = '12';

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
    await expect(upsertUser({ email: 'not-email', name: 'Test', role: 'SALES', password: VALID_PASSWORD } as never))
      .rejects.toThrow();
  });
  it('zod: name <2 символов → throw', async () => {
    await expect(upsertUser({ email: 'test@example.com', name: 'A', role: 'SALES', password: VALID_PASSWORD } as never))
      .rejects.toThrow();
  });
  it('zod: invalid role → throw', async () => {
    await expect(upsertUser({ email: 'test@example.com', name: 'Test', role: 'GUEST', password: VALID_PASSWORD } as never))
      .rejects.toThrow();
  });
  it('создание без пароля → throw', async () => {
    await expect(upsertUser({ email: 'test@example.com', name: 'Test', role: 'SALES' } as never))
      .rejects.toThrow('Пароль должен');
  });
  it('создание с коротким паролем (<12) → throw', async () => {
    await expect(upsertUser({ email: 'test@example.com', name: 'Test', role: 'SALES', password: SHORT_PASSWORD_5 } as never))
      .rejects.toThrow('Пароль должен');
  });
  it('создание → bcrypt.hash + user.create + audit user.create + mustChangePassword', async () => {
    mockDb.user.create.mockResolvedValue({ id: 'u-new' });
    await upsertUser({
      email: 'NEW@User.com', name: 'New User', role: 'LEGAL', password: VALID_PASSWORD,
    } as never);
    expect(mockBcryptHash).toHaveBeenCalledWith(VALID_PASSWORD, 10);
    const call = mockDb.user.create.mock.calls[0][0];
    expect(call.data.email).toBe('new@user.com');
    expect(call.data.passwordHash).toBe(`HASHED:${VALID_PASSWORD}`);
    // 06.05.2026: при создании нового юзера mustChangePassword=true (#91 аудита).
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
    expect(call.data.mustChangePassword).toBeUndefined();
  });
  it('с паролем >=12 → хеширует и обновляет hash + ставит mustChangePassword', async () => {
    await upsertUser({
      id: 'u-1', email: 'test@example.com', name: 'Test User', role: 'SALES', password: ANOTHER_VALID,
    } as never);
    expect(mockBcryptHash).toHaveBeenCalledWith(ANOTHER_VALID, 10);
    const call = mockDb.user.update.mock.calls[0][0];
    expect(call.data.passwordHash).toBe(`HASHED:${ANOTHER_VALID}`);
    // 06.05.2026 — пункт #32 аудита: при смене пароля admin'ом
    // сотрудник обязан сменить при следующем входе.
    expect(call.data.mustChangePassword).toBe(true);
  });
  it('с коротким паролем (<12) → игнорируется при обновлении', async () => {
    // 06.05.2026 — #33 аудита: короткий пароль сейчас бросает
    // ошибку — нельзя тихо «игнорировать» (раньше игнорировалось).
    await expect(upsertUser({
      id: 'u-1', email: 'test@example.com', name: 'Test User', role: 'SALES', password: SHORT_PASSWORD_2,
    } as never)).rejects.toThrow('Пароль должен');
    expect(mockBcryptHash).not.toHaveBeenCalled();
    expect(mockDb.user.update).not.toHaveBeenCalled();
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
  it('пароль <12 символов → throw', async () => {
    await expect(resetUserPassword('u-1', 'short')).rejects.toThrow('Пароль должен');
    expect(mockBcryptHash).not.toHaveBeenCalled();
  });
  it('валидный пароль → hash + update + audit reset_password + mustChangePassword', async () => {
    await resetUserPassword('u-1', VALID_PASSWORD);
    expect(mockBcryptHash).toHaveBeenCalledWith(VALID_PASSWORD, 10);
    expect(mockDb.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u-1' },
        data: { passwordHash: `HASHED:${VALID_PASSWORD}`, mustChangePassword: true },
      }),
    );
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.reset_password', entityId: 'u-1' }),
    );
  });
  it('не-админ → throw', async () => {
    mockRequireAdmin.mockImplementation(async () => { throw new Error('Forbidden'); });
    await expect(resetUserPassword('u-1', VALID_PASSWORD)).rejects.toThrow();
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });
});
