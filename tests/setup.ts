// Глобальные настройки vitest. Подменяем next/server и next/navigation чтобы
// можно было импортировать server actions без полного next runtime.
import { vi } from 'vitest';

// Заглушка для revalidatePath — server actions её зовут
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
}));

// next/headers — для cookies()/headers() в server actions
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: () => undefined, set: vi.fn() })),
  headers: vi.fn(() => new Map()),
}));
